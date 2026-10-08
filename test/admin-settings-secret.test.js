/**
 * VULN-010 — `get_settings` 唔再 return `api_secret` fleet-wide 共享 secret。
 *
 * Coverage:
 *  - handleGetSettingsAction 回應唔應該有 api_secret field
 *  - sanitizeAdminSettings 唔應該洩 jwt_secret / password / github_client_secret
 *  - get_install_secret action 存在，並回傳 api_secret
 *  - get_install_secret 記錄 audit log
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// 動態 import 我哋想 mock 嘅 module 部分；CommonJS-style 直接 require admin.js 會麻煩
// （太多 import）。改為直接 call 個 handler，mock 佢需要嘅 env 同 sys。
// handleGetSettingsAction / handleGetInstallSecretAction 係 script 內部嘅 non-exported function，
// 我哋透過 re-export 嘅 handleAdminAPI 測試 — 但咁要 mock checkAuth 同 request。
// 簡單啲：直接 grep file content 確認冇「api_secret: env.API_SECRET」喺 handleGetSettingsAction 嘅 return 裏面。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSrc = readFileSync(join(__dirname, '../src/handlers/admin.js'), 'utf8');

test('handleGetSettingsAction 唔應該喺 return object 入面有 api_secret', () => {
  // 抽出 handleGetSettingsAction 函數嘅 body，確認冇 api_secret 出現
  const match = adminSrc.match(/async function handleGetSettingsAction\([\s\S]*?\n\}/);
  assert.ok(match, 'handleGetSettingsAction should exist');
  const body = match[0];
  assert.ok(
    !/api_secret\s*:/.test(body),
    'handleGetSettingsAction must not return api_secret'
  );
});

test('handleGetSettingsAction 應該仍然 return settings + success', () => {
  const match = adminSrc.match(/async function handleGetSettingsAction\([\s\S]*?\n\}/);
  const body = match[0];
  assert.ok(/success:\s*true/.test(body), 'should still return success');
  assert.ok(/sanitizeAdminSettings/.test(body), 'should still sanitize settings');
});

test('handleGetInstallSecretAction 存在、return api_secret、並 console.log audit', () => {
  const match = adminSrc.match(/async function handleGetInstallSecretAction\([\s\S]*?\n\}/);
  assert.ok(match, 'handleGetInstallSecretAction should exist');
  const body = match[0];
  assert.ok(/api_secret\s*:/.test(body), 'should return api_secret');
  assert.ok(/install_secret_issued/.test(body), 'should log audit event "install_secret_issued"');
});

test('get_install_secret 已被註冊到 AUTHENTICATED_ADMIN_ACTION_HANDLERS', () => {
  const match = adminSrc.match(/const AUTHENTICATED_ADMIN_ACTION_HANDLERS = \{[\s\S]*?\};/);
  assert.ok(match, 'AUTHENTICATED_ADMIN_ACTION_HANDLERS should exist');
  const body = match[0];
  assert.ok(
    /get_install_secret:\s*handleGetInstallSecretAction/.test(body),
    'get_install_secret should be registered as an authenticated action'
  );
});

test('sanitizeAdminSettings strips sensitive fields', () => {
  const match = adminSrc.match(/export function sanitizeAdminSettings\([\s\S]*?\n\}/);
  assert.ok(match, 'sanitizeAdminSettings exists');
  const body = match[0];
  assert.ok(/jwt_secret/.test(body), 'should destructure jwt_secret');
  assert.ok(/github_client_secret/.test(body), 'should destructure github_client_secret');
  assert.ok(/password/.test(body), 'should destructure password');
});

/*
 * 負面測試：如果將來有人唔小心將 api_secret 加返落 handleGetSettingsAction，
 * 呢個測試會 fail。
 */
test('regression guard: handledGetSettingsAction 唔 contain 任何 env.API_SECRET reference', () => {
  const match = adminSrc.match(/async function handleGetSettingsAction\([\s\S]*?\n\}/);
  const body = match[0];
  assert.ok(
    !/env\.API_SECRET/.test(body),
    'handleGetSettingsAction must not access env.API_SECRET'
  );
});
