/**
 * Login rate limiter — VULN-002 fix.
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
 * 避免 lockout-DoS：
 *  - 只影響 (IP, username) 對，唔會成個 IP ban 死（其他 username 不受影響）
 *  - locked_until 係 soft lock：到期自動放行
 *  - 失敗 counter 唔會無限累積，window 過期即重置
 *
 * D1 schema: login_attempts(key TEXT PK, fails INT, window_start INT, locked_until INT)
 * key 係 SHA-256(`${ip}|${username}`) hex — 唔會將 raw IP 寫入 DB。
 */

const WINDOW_MS = 10 * 60 * 1000        // 10 min
const LOCKOUT_THRESHOLD = 10            // fails before hard lock
const LOCKOUT_MS = 15 * 60 * 1000       // 15 min lock
const BACKOFF_START = 5                 // 指數後退由第 5 次開始

async function hashKey(ip, username) {
  const data = new TextEncoder().encode(`${ip}|${username}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function ipOf(request) {
  // CF 提供 cf-connecting-ip；本地 dev fallback 去 x-forwarded-for / 'local'
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * 讀取 + 評估呢個 (ip, username) 係咪可以 proceed。
 * 返回：
 *   { allowed: true }                                       → 可以繼續
 *   { allowed: false, retryAfterSec, reason }               → 要拒絕
 *   { allowed: true, delaySec }                             → 可以 proceed 但要先 delay
 *
 * 注意：呢個 function 只負責讀取評估，唔會寫入。寫入失敗發生喺 recordFailure()。
 */
export async function checkLoginAllowed(request, env, username) {
  if (!env.DB) return { allowed: true }; // 無 DB → 唔擋（dev/test）

  const ip = ipOf(request);
  const key = await hashKey(ip, username || '');
  const now = Date.now();

  const row = await env.DB
    .prepare(`SELECT fails, window_start, locked_until FROM login_attempts WHERE key = ?`)
    .bind(key)
    .first();

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
    await env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(key).run();
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
 * 記錄一次失敗，返回最新狀態（用嚟話畀 client 知有幾多次機會）。
 */
export async function recordLoginFailure(request, env, username) {
  if (!env.DB) return { fails: 0 };

  const ip = ipOf(request);
  const key = await hashKey(ip, username || '');
  const now = Date.now();

  const existing = await env.DB
    .prepare(`SELECT fails, window_start FROM login_attempts WHERE key = ?`)
    .bind(key)
    .first();

  let fails;
  let lockedUntil = 0;

  if (!existing) {
    fails = 1;
    await env.DB.prepare(
      `INSERT INTO login_attempts (key, fails, window_start, locked_until) VALUES (?, 1, ?, 0)`
    ).bind(key, now).run();
  } else if (now - existing.window_start > WINDOW_MS) {
    fails = 1;
    await env.DB.prepare(
      `UPDATE login_attempts SET fails = 1, window_start = ?, locked_until = 0 WHERE key = ?`
    ).bind(now, key).run();
  } else {
    fails = existing.fails + 1;
    if (fails >= LOCKOUT_THRESHOLD) {
      lockedUntil = now + LOCKOUT_MS;
    }
    await env.DB.prepare(
      `UPDATE login_attempts SET fails = ?, locked_until = ? WHERE key = ?`
    ).bind(fails, lockedUntil, key).run();
  }

  return { fails, lockedUntil };
}

/**
 * 成功登入後清除 counter。
 */
export async function clearLoginFailures(request, env, username) {
  if (!env.DB) return;
  const ip = ipOf(request);
  const key = await hashKey(ip, username || '');
  await env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(key).run();
}

/**
 * 簡單 delay helper（non-blocking within the worker）.
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
