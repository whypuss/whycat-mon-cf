/**
 * VULN-002 — Login rate limiter 單元測試。
 *
 * Coverage:
 *  - checkLoginAllowed: 乾淨 state → allowed
 *  - checkLoginAllowed: hard lock 未過期 → 429 with retryAfter
 *  - checkLoginAllowed: window 過期 → 通過 + counter reset
 *  - checkLoginAllowed: 5..9 fails → delaySec 存在 (exponential backoff)
 *  - recordLoginFailure: counter 累積
 *  - recordLoginFailure: 達到 LOCKOUT_THRESHOLD 設 locked_until
 *  - clearLoginFailures: 成功後刪除 row
 *  - hashKey SHA-256 唔同 IP / username 會產生唔同 key
 *  - 無 DB (dev) → 唔擋
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  __resetSchemaCacheForTest,
} from '../src/utils/loginRateLimit.js';

beforeEach(() => {
  __resetSchemaCacheForTest();
});

/* ---------------- Mock D1 ---------------- */

function makeDb(options = {}) {
  const store = new Map(); // key -> { fails, window_start, locked_until }
  const { failOn = null } = options; // 'read' | 'write' | 'create' | null
  let createCalls = 0;
  return {
    store,
    createCalls: () => createCalls,
    prepare(sql) {
      return {
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async first() {
          if (failOn === 'read' && /FROM login_attempts/.test(sql)) {
            throw new Error('D1 read error (simulated)');
          }
          if (/FROM login_attempts WHERE key/.test(sql)) {
            return store.get(this.params[0]) ?? null;
          }
          return null;
        },
        async run() {
          if (/CREATE TABLE IF NOT EXISTS login_attempts/.test(sql)) {
            createCalls += 1;
            if (failOn === 'create') {
              throw new Error('D1 create error (simulated)');
            }
            return { success: true };
          }
          if (failOn === 'write' && /INSERT INTO login_attempts|UPDATE login_attempts|DELETE FROM login_attempts/.test(sql)) {
            throw new Error('D1 write error (simulated)');
          }
          if (/INSERT INTO login_attempts/.test(sql)) {
            store.set(this.params[0], {
              fails: 1,
              window_start: Number(this.params[1]),
              locked_until: 0,
            });
            return { success: true };
          }
          if (/UPDATE login_attempts SET fails = \?, locked_until = \? WHERE key = \?/.test(sql)) {
            const cur = store.get(this.params[2]) || {};
            store.set(this.params[2], {
              ...cur,
              fails: Number(this.params[0]),
              locked_until: Number(this.params[1]),
            });
            return { success: true };
          }
          if (/UPDATE login_attempts SET fails = 1, window_start = \?, locked_until = 0 WHERE key = \?/.test(sql)) {
            store.set(this.params[1], {
              fails: 1,
              window_start: Number(this.params[0]),
              locked_until: 0,
            });
            return { success: true };
          }
          if (/DELETE FROM login_attempts/.test(sql)) {
            store.delete(this.params[0]);
            return { success: true };
          }
          return { success: true };
        },
      };
    },
  };
}

function makeRequest(ip = '203.0.113.10') {
  return {
    headers: {
      get(name) {
        if (name === 'cf-connecting-ip') return ip;
        return null;
      },
    },
  };
}

/* ---------------- Tests ---------------- */

test('checkLoginAllowed: 乾淨 state → allowed', async () => {
  const env = { DB: makeDb() };
  const r = await checkLoginAllowed(makeRequest(), env, 'admin');
  assert.deepEqual(r, { allowed: true });
});

test('checkLoginAllowed: 無 DB → allowed（dev fallback）', async () => {
  const r = await checkLoginAllowed(makeRequest(), { DB: null }, 'admin');
  assert.deepEqual(r, { allowed: true });
});

test('recordLoginFailure: 累積 counter', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  const r1 = await recordLoginFailure(req, env, 'admin');
  assert.equal(r1.fails, 1);
  const r2 = await recordLoginFailure(req, env, 'admin');
  assert.equal(r2.fails, 2);
  const r3 = await recordLoginFailure(req, env, 'admin');
  assert.equal(r3.fails, 3);
});

test('recordLoginFailure: 達到 LOCKOUT_THRESHOLD (10) 設 locked_until', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  for (let i = 0; i < 9; i++) {
    await recordLoginFailure(req, env, 'admin');
  }
  const r = await recordLoginFailure(req, env, 'admin');
  assert.equal(r.fails, 10);
  assert.ok(r.lockedUntil > Date.now(), 'locked_until should be set in the future');
});

test('checkLoginAllowed: 硬 lock 未過期 → 拒絕 + retryAfterSec', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  for (let i = 0; i < 10; i++) await recordLoginFailure(req, env, 'admin');

  const r = await checkLoginAllowed(req, env, 'admin');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'locked');
  assert.ok(r.retryAfterSec > 0, 'should give a retryAfter window');
  assert.ok(r.retryAfterSec <= 15 * 60, 'lock window should not exceed 15 min');
});

test('checkLoginAllowed: 5..9 fails → allowed 但有 delaySec（exponential backoff）', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  for (let i = 0; i < 7; i++) await recordLoginFailure(req, env, 'admin');

  const r = await checkLoginAllowed(req, env, 'admin');
  assert.equal(r.allowed, true);
  assert.ok(r.delaySec > 0, 'should require a delay');
  assert.equal(r.delaySec, Math.pow(2, 7 - 4), 'exponential: 2^(fails-4) = 8s for 7 fails');
});

test('checkLoginAllowed: 4 fails → allowed 冇 delay', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  for (let i = 0; i < 4; i++) await recordLoginFailure(req, env, 'admin');
  const r = await checkLoginAllowed(req, env, 'admin');
  assert.equal(r.allowed, true);
  assert.equal(r.delaySec, undefined);
});

test('clearLoginFailures: 刪除 row，之後 attempt 重新由 0 開始', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  for (let i = 0; i < 5; i++) await recordLoginFailure(req, env, 'admin');
  await clearLoginFailures(req, env, 'admin');

  const r = await checkLoginAllowed(req, env, 'admin');
  assert.deepEqual(r, { allowed: true });

  const r1 = await recordLoginFailure(req, env, 'admin');
  assert.equal(r1.fails, 1, 'counter reset after clear');
});

test('recordLoginFailure: window 過期 → counter reset', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  const r1 = await recordLoginFailure(req, env, 'admin');
  assert.equal(r1.fails, 1);

  // 人工將 window_start 拉返 11 分鐘前
  for (const [k, v] of env.DB.store) {
    env.DB.store.set(k, { ...v, window_start: Date.now() - 11 * 60 * 1000 });
  }
  const r2 = await recordLoginFailure(req, env, 'admin');
  assert.equal(r2.fails, 1, 'reset when window elapsed');
});

test('per-(IP,username) isolation: 唔同 IP 唔會互相影響', async () => {
  const env = { DB: makeDb() };
  const reqA = makeRequest('203.0.113.1');
  const reqB = makeRequest('203.0.113.2');

  for (let i = 0; i < 10; i++) await recordLoginFailure(reqA, env, 'admin');

  const checkA = await checkLoginAllowed(reqA, env, 'admin');
  const checkB = await checkLoginAllowed(reqB, env, 'admin');

  assert.equal(checkA.allowed, false, 'attacker IP locked');
  assert.equal(checkB.allowed, true, 'other IP unaffected');
});

test('per-(IP,username) isolation: 同一 IP 唔同 username 唔影響', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();

  for (let i = 0; i < 10; i++) await recordLoginFailure(req, env, 'admin');

  const checkAdmin = await checkLoginAllowed(req, env, 'admin');
  const checkOther = await checkLoginAllowed(req, env, 'root');

  assert.equal(checkAdmin.allowed, false);
  assert.equal(checkOther.allowed, true);
});

test('DoS resistance: locked_until 到期後自動放行', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  for (let i = 0; i < 10; i++) await recordLoginFailure(req, env, 'admin');

  // 人工將 locked_until 拉返 1 秒前（expired）
  for (const [k, v] of env.DB.store) {
    env.DB.store.set(k, { ...v, locked_until: Date.now() - 1000 });
  }
  const r = await checkLoginAllowed(req, env, 'admin');
  assert.equal(r.allowed, true, 'expired lock should allow');
});

test('cold-start: schema self-bootstrap，direct POST 唔使 /api/config', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  await recordLoginFailure(req, env, 'admin');
  const r = await checkLoginAllowed(req, env, 'admin');
  assert.equal(r.allowed, true);
  assert.ok(env.DB.createCalls() >= 1, 'schema should be ensured');
});

test('cold-start: CREATE TABLE IF NOT EXISTS 至少執行一次', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  await recordLoginFailure(req, env, 'admin');
  await checkLoginAllowed(req, env, 'admin');
  assert.ok(env.DB.createCalls() >= 1);
});

test('D1 read error: fail closed，唔俾 attacker 利用 storage error 繞過', async () => {
  const env = { DB: makeDb({ failOn: 'read' }) };
  const req = makeRequest();
  const r = await checkLoginAllowed(req, env, 'admin');
  assert.equal(r.allowed, false, 'storage error 應該 deny，唔係 allow');
  assert.equal(r.reason, 'storage');
  assert.ok(r.retryAfterSec > 0);
});

test('D1 create schema error: fail closed', async () => {
  const env = { DB: makeDb({ failOn: 'create' }) };
  const req = makeRequest();
  const r = await checkLoginAllowed(req, env, 'admin');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'storage');
});

test('D1 write error: recordLoginFailure throw（caller 應該 fail closed 503）', async () => {
  const env = { DB: makeDb({ failOn: 'write' }) };
  const req = makeRequest();
  try {
    await recordLoginFailure(req, env, 'admin');
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.name, 'RateLimitStorageError');
  }
});

test('ip spoof: 唔信 x-forwarded-for', async () => {
  const env = { DB: makeDb() };
  const reqA = {
    headers: {
      get(name) {
        if (name === 'cf-connecting-ip') return '203.0.113.1';
        if (name === 'x-forwarded-for') return '203.0.113.99';
        return null;
      },
    },
  };
  await recordLoginFailure(reqA, env, 'admin');
  const reqB = {
    headers: {
      get(name) {
        if (name === 'cf-connecting-ip') return '203.0.113.99';
        return null;
      },
    },
  };
  const r1 = await recordLoginFailure(reqA, env, 'admin');
  const r2 = await recordLoginFailure(reqB, env, 'admin');
  assert.equal(r1.fails, 2);
  assert.equal(r2.fails, 1);
});

test('concurrent: Promise.all 唔會爆', async () => {
  const env = { DB: makeDb() };
  const req = makeRequest();
  const results = await Promise.all([
    recordLoginFailure(req, env, 'admin'),
    recordLoginFailure(req, env, 'admin'),
  ]);
  assert.equal(results.length, 2);
  const maxFails = Math.max(results[0].fails, results[1].fails);
  assert.ok(maxFails >= 1 && maxFails <= 2);
});
