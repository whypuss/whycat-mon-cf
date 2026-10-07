#!/usr/bin/env bash
# ==============================================================================
# CF-Server-Monitor 通用升級/安裝腳本 (Cross-Platform Hot Update)
# 支援: Ubuntu / Debian / CentOS / Rocky / Alpine Linux / OpenWrt
# 功能: 下載自研 v1.2.1-unlock 二進制，自動偵測 systemd / OpenRC，保留現有設定
# ==============================================================================

set -euo pipefail

URL="https://komari.moggy.ccwu.cc/download/cf-probe-v1.2.1-linux-amd64"
SHA="4e8aac0ba53905999ce58dbef2151e17ee5c5f038efa3374561c7fb5e7ed95da"

echo "========================================================"
echo " CF-Server-Monitor Probe v1.2.1-unlock 部署/熱升級"
echo "========================================================"

# 1. 下載二進制
echo "==> [1/5] 下載 v1.2.1-unlock 二進制..."
curl -fSL "$URL" -o /tmp/cf-probe

# 2. SHA256 校驗
echo "==> [2/5] 驗證 SHA256 完整性..."
echo "$SHA  /tmp/cf-probe" | sha256sum -c -

chmod 0755 /tmp/cf-probe

# 3. 檢查參數：若是首次安裝 (帶有 -id/-secret/-url)，則調用 binary 自身的 install
if [[ "$*" == *"-id="* && "$*" == *"-secret="* ]]; then
  echo "==> [3/5] 偵測到首次安裝參數，執行原生註冊配置..."
  
  # 若第一項參數是 'install'，先移除，避免傳遞成 'cf-probe install install -id=...'
  if [[ "${1:-}" == "install" ]]; then
    shift
  fi

  /tmp/cf-probe install "$@"
  rm -f /tmp/cf-probe
  echo "==> 安裝註冊完成！"
  exit 0
fi

# 4. 熱升級模式：保留舊有配置，僅原子替換二進制並重啟服務
echo "==> [3/5] 執行熱升級模式（保留原有設定檔）..."

if command -v systemctl >/dev/null 2>&1; then
  echo "  - 停止 systemd 服務..."
  systemctl stop cf-probe 2>/dev/null || true
elif command -v rc-service >/dev/null 2>&1; then
  echo "  - 停止 OpenRC 服務..."
  rc-service cf-probe stop 2>/dev/null || true
fi

echo "==> [4/5] 原子替換二進制到 /usr/local/bin/cf-probe..."
install -m 0755 /tmp/cf-probe /usr/local/bin/cf-probe
rm -f /tmp/cf-probe

echo "==> [5/5] 重啟守護進程..."
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart cf-probe
  systemctl is-active --quiet cf-probe && echo "==> [OK] systemd 服務運行中 (active)"
elif command -v rc-service >/dev/null 2>&1; then
  rc-service cf-probe restart
  rc-service cf-probe status 2>/dev/null || true
  echo "==> [OK] OpenRC 服務運行中 (started)"
fi

echo "========================================================"
echo " 升級成功！現行版本: v1.2.1-unlock"
echo " SHA256: $(sha256sum /usr/local/bin/cf-probe | awk '{print $1}')"
echo "========================================================"
