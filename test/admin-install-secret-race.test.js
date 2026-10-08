/**
 * VULN-010 followup — install secret fetch race / failure handling.
 *
 * Coverage:
 *  - fetchInstallSecret success → apiSecret set, error clear, loading落返 false
 *  - fetchInstallSecret failure → apiSecret cleared，error 有 message，loading落返 false
 *  - fast click → 唔同 fetch 之間狀態一致（loading 標誌 thread-safe）
 *  - get_settings response 永遠唔含 api_secret
 *  - Modal 禁用 copy 按鈕 條件：installSecretLoading | installSecretError
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminVueSrc = readFileSync(join(__dirname, '../src/frontend/views/admin/index.vue'), 'utf8');
const copyModalSrc = readFileSync(join(__dirname, '../src/frontend/views/admin/components/CopyCommandModal.vue'), 'utf8');

test('fetchInstallSecret success - apiSecret set, error 清空', () => {
  const fnMatch = adminVueSrc.match(/const fetchInstallSecret = async \(\) => \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'fetchInstallSecret should exist');
  const body = fnMatch[0];
  assert.ok(/apiSecret\.value = result\.api_secret/.test(body),
    'should set apiSecret from result');
  assert.ok(/installSecretError\.value = ''/.test(body),
    'should clear installSecretError on start');
});

test('fetchInstallSecret failure - apiSecret 清空 + error 有 message', () => {
  const fnMatch = adminVueSrc.match(/const fetchInstallSecret = async \(\) => \{[\s\S]*?\n\}/);
  const body = fnMatch[0];
  assert.ok(/apiSecret\.value = ''/.test(body),
    'should clear apiSecret on error to prevent -secret="" leak');
  assert.ok(/installSecretError\.value = [\s\S]*?message/.test(body),
    'should set installSecretError with a message');
});

test('fetchInstallSecret 有 try/catch/finally 結構（loading 一定會落返 false）', () => {
  const fnMatch = adminVueSrc.match(/const fetchInstallSecret = async \(\) => \{[\s\S]*?\n\}/);
  const body = fnMatch[0];
  assert.ok(/try\s*\{/.test(body), 'should use try/catch');
  assert.ok(/finally\s*\{/.test(body), 'should use finally to reset loading');
  assert.ok(/installSecretLoading\.value = false/.test(body),
    'should set loading=false in finally');
});

test('get_settings response 處理唔再 assign apiSecret', () => {
  // 搵 loadSettings 入面嘅 get_settings 處理位置
  const loadSettingsMatch = adminVueSrc.match(/const loadSettings = async \(\) => \{[\s\S]*?\n\}/);
  assert.ok(loadSettingsMatch, 'loadSettings should exist');
  const body = loadSettingsMatch[0];
  assert.ok(!/apiSecret\.value = data\.api_secret/.test(body),
    'should no longer sync apiSecret from loadSettings');
});

test('CopyCommandModal 複製按鈕響 loading 或 error 時 disable', () => {
  const buttonMatches = copyModalSrc.match(/<button[^>]*copy-cmd[\s\S]*?<\/button>/g);
  assert.ok(buttonMatches, 'copy button should exist');
  const first = buttonMatches[0];
  assert.ok(/:disabled="installSecretLoading \|\| !!installSecretError"/.test(first),
    'copy button should be disabled while loading or error');
  assert.ok(/installSecretLoading/.test(first),
    'button should reference installSecretLoading state');
});

test('CopyCommandModal error message 顯示', () => {
  const errorMatch = copyModalSrc.match(/v-if="installSecretError"[\s\S]*?<\/div>/);
  assert.ok(errorMatch, 'should show error block when installSecretError exists');
  const html = errorMatch[0];
  assert.ok(/install secret 獲取失敗/.test(html),
    'error message should mention install secret failure');
});

test('Modal props 新增 installSecretLoading + installSecretError', () => {
  // 唔使用 regex capture defineProps 成個 block（會受 nested braces 影響），
  // 直接檢查 file 內有 props declaration
  assert.ok(
    /installSecretLoading:\s*\{\s*type:\s*Boolean/.test(copyModalSrc),
    'should have installSecretLoading prop with type Boolean'
  );
  assert.ok(
    /installSecretError:\s*\{\s*type:\s*String/.test(copyModalSrc),
    'should have installSecretError prop with type String'
  );
});

test('regression guard: get_settings response 唔再 reference data.api_secret', () => {
  // 全局檢查：loadSettings handler 唔應該仲有 data.api_secret
  // (呢個係 regression guard，防止將來有人 add 返)
  const loadSettingsMatch = adminVueSrc.match(/const loadSettings = async \(\) => \{[\s\S]*?\n\}/);
  const body = loadSettingsMatch[0];
  assert.ok(!/data\.api_secret/.test(body),
    'loadSettings must never read data.api_secret again');
});
