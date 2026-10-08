/**
 * Login rate limiter — VULN-002 fix（強化版）.
 *
 * Per (IP + username) rolling-window counter in D1, with exponential backoff
 * and a hard lockout after enough consecutive failures. Server-side enforced;
 * 唔依賴 Turnstile 或 client。
 *
 * Rules (per spec):
 *  - Window:        10 分鐘 rolling
 *  - 0..4 fails:    通過
 *  - 5..9 fails:    指數後退（2^(fails-4) 秒，即 2s/4s/8s/16s/32s）
 *  - 10+ fails:     鎖 15 分鐘
 *  - 成功登入:      清除計數
 *
 * 防 DoS：
 *  - per (IP, username) pair 隔離，唔會成個 IP / 全服務被 attacker 鎖死
 *  - locked_until 係 soft lock，到期自動放行
 *  - window 過期自動重置 counter
 *
 * Schema 自舉（VULN-002 gate review fix）：
 *  - 每個 public function 開頭呼叫 ensureLoginAttemptsSchema，CREATE TABLE IF NOT EXISTS
 *  - D1 prepare cached 同一 statement，實際成本低；CREATE IF NOT EXISTS 係 idempotent safe
 *  - 唔再依賴 /api/config 先觸發 initDatabase；direct POST /admin/api 都正常運作
 *  - module-level promise 避免並發下重複 CREATE（雖然 IF NOT EXISTS 係 safe，但避免多餘 D1 round trip）
 *
 * IP 信任（VULN-002 gate review fix）：
 *  - 只信 Cloudflare 提供嘅 `cf-connecting-ip`
 *  - 唔读 attacker 可控制嘅 `x-forwarded-for`
 *  - 冇 cf-connecting-ip 時（本地 dev 或非 CF 環境），用 'anonymous' 作為共享 bucket —
 *    即係話本地 dev 全用同一個 key，唔會洩漏真 IP 亦唔會被 spoof
 *
 * Fail-closed on D1 error（VULN-002 gate review fix）：
 *  - 如果 D1 查詢失敗（network error / schema issue）→ return 503 with retryAfter，
 *    唔係放行 login。Security control 唔應該因為自身 failure 而 fail-open。
 *  - 503 with retry 會觸發正常 user 嘅 retry，而 attacker 嘅 brute force 會被明確阻擋。
 *  - 同時對正常用戶透明：admin 會見到清晰「server 暫時唔可用」錯誤。
 *
 * D1 schema: login_attempts(key TEXT PK, fails INT, window_start INT, locked_until INT)
 * key 係 SHA-256(`${ip}|${username}`) hex — 唔會將 raw IP 寫入 DB。
 */

const WINDOW_MS = 10 * 60 * 1000        // 10 min
const LOCKOUT_THRESHOLD = 10            // fails before hard lock
const LOCKOUT_MS = 15 * 60 * 1000       // 15 min lock
const BACKOFF_START = 5                 // 指數後退由第 5 次開始

/* 每 isolate 只跑一次 schema ensure（CREATE TABLE IF NOT EXISTS 係 idempotent） */
let schemaEnsurePromise = null;
function ensureLoginAttemptsSchema(db) {
  if (!db) return Promise.resolve();
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = db.prepare(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY,
        fails INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      )
    `).run().catch((err) => {
      // reset promise 俾下次 retry；唔會將暫時 D1 錯誤永久 latch
      schemaEnsurePromise = null;
      throw err;
    });
  }
  return schemaEnsurePromise;
}

/*
 * 供 test 用：重置 module-level schema cache。
 * 生產環境唔應該 call 呢個；每個 Worker isolate 都係 fresh 嘅。
 */
export function __resetSchemaCacheForTest() {
  schemaEnsurePromise = null;
}

async function hashKey(ip, username) {
  const data = new TextEncoder().encode(`${ip}|${username}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/*
 * IP 信任原則：只信 Cloudflare 提供嘅 `cf-connecting-ip`。
 * `x-forwarded-for` 係 attacker 可以完全控制嘅 header，唔可信。
 * 冇 cf-connecting-ip 時（本地 dev / bypass CF 直達 worker），
 * 用固定字串 'anonymous' — 咁做表示「本地環境共用一個 rate bucket」，
 * 唔會令 attacker 比真實用戶更容易繞過 rate limit（佢哋都係 'anonymous'）。
 */
function ipOf(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  return 'anonymous';
}

/*
 * 封裝 D1 call，發生 error 嘅時候 throw 一個統一形狀嘅 RateLimitStorageError。
 * Caller 會 catch 呢個再決定點 fail-closed。
 */
class RateLimitStorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RateLimitStorageError';
    this.cause = cause;
  }
}

async function dbFirst(db, sql, ...params) {
  try {
    return await db.prepare(sql).bind(...params).first();
  } catch (err) {
    throw new RateLimitStorageError('read failed', err);
  }
}

async function dbRun(db, sql, ...params) {
  try {
    return await db.prepare(sql).bind(...params).run();
  } catch (err) {
    throw new RateLimitStorageError('write failed', err);
  }
}

/**
 * 讀取 + 評估呢個 (ip, username) 係咪可以 proceed。
 *
 * 返回：
 *   { allowed: true }                                  → 可以繼續
 *   { allowed: true, delaySec }                        → 可以 proceed 但要先 delay
 *   { allowed: false, retryAfterSec, reason: 'locked' }  → 帳號暫時被鎖，retry after
 *   { allowed: false, retryAfterSec, reason: 'storage' } → schema/D1 錯誤，fail closed
 *
 * 呢個 function 只負責讀取評估，唔會寫入。寫入失敗發生喺 recordFailure()。
 */
export async function checkLoginAllowed(request, env, username) {
  if (!env || !env.DB) return { allowed: true }; // 無 DB → 唔擋（unit test mock 情況）

  // Schema self-bootstrap（係 idempotent cheap）
  try {
    await ensureLoginAttemptsSchema(env.DB);
  } catch (err) {
    // Schema 連 CREATE 都失敗 — fail closed，唔俾 attacker 利用 schema issue 繞過
    return {
      allowed: false,
      retryAfterSec: 30,
      reason: 'storage',
    };
  }

  const ip = ipOf(request);
  const key = await hashKey(ip, username || '');
  const now = Date.now();

  let row;
  try {
    row = await dbFirst(env.DB,
      `SELECT fails, window_start, locked_until FROM login_attempts WHERE key = ?`,
      key
    );
  } catch (err) {
    if (err instanceof RateLimitStorageError) {
      return { allowed: false, retryAfterSec: 30, reason: 'storage' };
    }
    throw err;
  }

  if (!row) return { allowed: true };

  // Hard lock 未過期
  if (row.locked_until > now) {
    const retryAfterSec = Math.ceil((row.locked_until - now) / 1000);
    return {
      allowed: false,
      retryAfterSec,
      reason: 'locked',
    };
  }

  // Window 過咗 → 重置（視為新開始）
  if (now - row.window_start > WINDOW_MS) {
    try {
      await dbRun(env.DB, `DELETE FROM login_attempts WHERE key = ?`, key);
    } catch (_) {
      // 刪除失敗唔阻塞 proceed（視為 window 過期放行）
    }
    return { allowed: true };
  }

  // Soft backoff
  if (row.fails >= BACKOFF_START && row.fails < LOCKOUT_THRESHOLD) {
    const delaySec = Math.pow(2, row.fails - (BACKOFF_START - 1));
    return { allowed: true, delaySec };
  }

  return { allowed: true };
}

/**
 * 記錄一次失敗，返回最新狀態。
 *
 * D1 寫入失敗會 throw RateLimitError — caller（login handler）需要 catch
 * 並 fail closed，唔好 silent-ignore（否則 attacker 可以不停試而永遠 0 counter）。
 */
export async function recordLoginFailure(request, env, username) {
  if (!env || !env.DB) return { fails: 0 };

  await ensureLoginAttemptsSchema(env.DB);

  const ip = ipOf(request);
  const key = await hashKey(ip, username || '');
  const now = Date.now();

  const existing = await dbFirst(env.DB,
    `SELECT fails, window_start FROM login_attempts WHERE key = ?`,
    key
  );

  let fails;
  let lockedUntil = 0;

  if (!existing) {
    fails = 1;
    await dbRun(env.DB,
      `INSERT INTO login_attempts (key, fails, window_start, locked_until) VALUES (?, 1, ?, 0)`,
      key, now
    );
  } else if (now - existing.window_start > WINDOW_MS) {
    fails = 1;
    await dbRun(env.DB,
      `UPDATE login_attempts SET fails = 1, window_start = ?, locked_until = 0 WHERE key = ?`,
      now, key
    );
  } else {
    fails = existing.fails + 1;
    if (fails >= LOCKOUT_THRESHOLD) {
      lockedUntil = now + LOCKOUT_MS;
    }
    await dbRun(env.DB,
      `UPDATE login_attempts SET fails = ?, locked_until = ? WHERE key = ?`,
      fails, lockedUntil, key
    );
  }

  return { fails, lockedUntil };
}

/**
 * 成功登入後清除 counter。失敗唔 throw，唔影響 login 成功流程。
 */
export async function clearLoginFailures(request, env, username) {
  if (!env || !env.DB) return;
  try {
    await ensureLoginAttemptsSchema(env.DB);
    const ip = ipOf(request);
    const key = await hashKey(ip, username || '');
    await dbRun(env.DB, `DELETE FROM login_attempts WHERE key = ?`, key);
  } catch (_) {
    // 清除失敗唔影響 user 已經 login 成功；唔好 bubble up
  }
}

/**
 * delay helper（non-blocking）。
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
