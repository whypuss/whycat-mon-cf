#!/usr/bin/env bash
# ==============================================================================
# CF-Server-Monitor Probe v1.2.1-unlock 專用熱升級腳本 (Binary-Only Upgrade)
# 支援: Ubuntu / Debian / CentOS / Rocky / Alpine Linux / OpenWrt
# 特點:
#   1. 僅替換二進制，100% 保留現有配置（/etc/config/cf-probe/config.conf）
#   2. 不走 cf-probe install，絕不修改或覆蓋 ID、Secret、URL 及三網自訂節點
#   3. 自動適配 systemd 與 Alpine OpenRC
#   4. 強制 SHA256 校驗與原子替換
# ==============================================================================

set -euo pipefail

URL="https://komari.moggy.ccwu.cc/download/cf-probe-v1.2.1-linux-amd64"
SHA="4e8aac0ba53905999ce58dbef2151e17ee5c5f038efa3374561c7fb5e7ed95da"

echo "========================================================"
echo " CF-Server-Monitor Probe v1.2.1-unlock 熱升級 (無損升級)"
echo "========================================================"

# 1. 檢查本機是否已有安裝
if [ ! -f /usr/local/bin/cf-probe ]; then
  echo "==> [WARN] 尚未偵測到 /usr/local/bin/cf-probe，執行新安裝部署..."
fi

# 2. 下載二進制（自動 fallback curl → wget；OpenWrt/Alpine BusyBox 通常只有 wget）
echo "==> [1/4] 下載 v1.2.1-unlock 二進制..."
if command -v curl >/dev/null 2>&1; then
  curl -fSL "$URL" -o /tmp/cf-probe
elif command -v wget >/dev/null 2>&1; then
  wget -qO /tmp/cf-probe "$URL"
else
  echo "FATAL: 系統冇 curl 亦冇 wget，請先安裝其中一個"
  echo "  apk add curl            # Alpine"
  echo "  apt install curl -y     # Debian/Ubuntu"
  echo "  opkg install curl       # OpenWrt"
  exit 2
fi

# 3. SHA256 校驗
echo "==> [2/4] 驗證 SHA256 完整性..."
echo "$SHA  /tmp/cf-probe" | sha256sum -c -

chmod 0755 /tmp/cf-probe

# 4. 停止現有服務（不觸碰設定檔）
echo "==> [3/4] 停止現有守護進程（保留原有設定檔）..."
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop cf-probe 2>/dev/null || true
elif command -v rc-service >/dev/null 2>&1; then
  rc-service cf-probe stop 2>/dev/null || true
fi

# 5. 原子替換二進制
install -m 0755 /tmp/cf-probe /usr/local/bin/cf-probe
rm -f /tmp/cf-probe

# 6. 重啟服務
echo "==> [4/4] 重新啟動守護進程..."
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart cf-probe
  systemctl is-active --quiet cf-probe && echo "==> [OK] systemd 服務運行中 (active)"
elif command -v rc-service >/dev/null 2>&1; then
  rc-service cf-probe restart
  rc-service cf-probe status 2>/dev/null || true
  echo "==> [OK] OpenRC 服務運行中 (started)"
fi

echo "========================================================"
echo " 升級完成！現行版本: v1.2.1-unlock"
echo " SHA256: $(sha256sum /usr/local/bin/cf-probe | awk '{print $1}')"
echo " 配置狀態: 原始設定檔完整保留"
echo "========================================================"
