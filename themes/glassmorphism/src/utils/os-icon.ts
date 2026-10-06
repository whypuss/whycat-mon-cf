/**
 * OS 图标解析。
 *
 * 映射规则完全对照 CFSM 官方前端 `src/frontend/utils/osIcon.js`，
 * 并按 `theme-develop.md` 的要求使用默认皮肤的 `/os-icons/<filename>` 静态资源，
 * 不在主题里重复打包图标。关键字匹配顺序与官方保持一致（先匹配先命中）。
 */
interface OsIconConfig {
  readonly name: string
  readonly image: string
  readonly keywords: readonly string[]
}

const OS_ICON_BASE = '/os-icons/'

const OS_CONFIGS: readonly OsIconConfig[] = [
  { name: 'AlmaLinux', image: 'os-alma.svg', keywords: ['alma', 'almalinux'] },
  { name: 'Alpine Linux', image: 'os-alpine.webp', keywords: ['alpine', 'alpine linux'] },
  { name: 'CentOS', image: 'os-centos.svg', keywords: ['centos', 'cent os'] },
  { name: 'Debian', image: 'os-debian.svg', keywords: ['debian', 'debian gnu/linux', 'deb'] },
  { name: 'Ubuntu', image: 'os-ubuntu.svg', keywords: ['ubuntu', 'elementary'] },
  { name: 'macOS', image: 'os-macos.svg', keywords: ['macos', 'mac os', 'darwin', 'os x'] },
  { name: 'Windows', image: 'os-windows.svg', keywords: ['windows', 'win32', 'win64', 'win10', 'win11', 'win server', 'microsoft'] },
  { name: 'Arch Linux', image: 'os-arch.svg', keywords: ['arch', 'archlinux', 'arch linux'] },
  { name: 'Kali Linux', image: 'os-kail.svg', keywords: ['kail', 'kali', 'kali linux'] },
  { name: 'iStoreOS', image: 'os-istore.png', keywords: ['istore', 'istoreos', 'istore os'] },
  { name: 'OpenWrt', image: 'os-openwrt.svg', keywords: ['openwrt', 'open wrt', 'open-wrt', 'qwrt', 'kwrt'] },
  { name: 'ImmortalWrt', image: 'os-openwrt.svg', keywords: ['immortalwrt', 'immortal', 'emmortal'] },
  { name: 'NixOS', image: 'os-nix.svg', keywords: ['nixos', 'nix os', 'nix'] },
  { name: 'Rocky Linux', image: 'os-rocky.svg', keywords: ['rocky', 'rocky linux'] },
  { name: 'Fedora', image: 'os-fedora.svg', keywords: ['fedora'] },
  { name: 'openSUSE', image: 'os-openSUSE.svg', keywords: ['opensuse', 'open suse', 'suse'] },
  { name: 'Gentoo', image: 'os-gentoo.svg', keywords: ['gentoo'] },
  { name: 'Red Hat', image: 'os-redhat.svg', keywords: ['redhat', 'rhel', 'red hat'] },
  { name: 'Linux Mint', image: 'os-mint.svg', keywords: ['mint', 'linux mint'] },
  { name: 'Manjaro', image: 'os-manjaro-.svg', keywords: ['manjaro'] },
  { name: 'Armbian', image: 'os-armbian.png', keywords: ['armbox', 'armbian'] },
  { name: 'Synology DSM', image: 'os-synology.ico', keywords: ['synology', 'dsm', 'synology dsm'] },
  { name: 'Proxmox VE', image: 'os-proxmox.ico', keywords: ['proxmox', 'proxmox ve', 'pve'] },
  { name: 'Alibaba Cloud Linux', image: 'os-alibaba.svg', keywords: ['alibaba', 'aliyun', 'alinux', 'anolis', 'openanolis', '阿里', '龙蜥'] },
  { name: 'OpenCloudOS', image: 'os-opencloud.svg', keywords: ['opencloud', 'opencloudos', 'opencloud os'] },
  { name: 'Oracle Linux', image: 'os-oracle.svg', keywords: ['oracle', 'oracle linux'] },
]

const DEFAULT_OS_CONFIG: OsIconConfig = {
  name: 'Unknown',
  image: 'os-unknown.svg',
  keywords: ['unknown'],
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().trim()
}

export function findOsConfig(osString: string | null | undefined): OsIconConfig {
  const normalized = normalize(osString)
  if (!normalized) return DEFAULT_OS_CONFIG
  return OS_CONFIGS.find((config) => config.keywords.some((keyword) => normalized.includes(keyword)))
    ?? DEFAULT_OS_CONFIG
}

export function osIconUrl(osString: string | null | undefined): string {
  return `${OS_ICON_BASE}${findOsConfig(osString).image}`
}

export function osDisplayName(osString: string | null | undefined): string {
  const config = findOsConfig(osString)
  if (config !== DEFAULT_OS_CONFIG) return config.name

  const raw = String(osString ?? '').trim()
  if (!raw) return DEFAULT_OS_CONFIG.name
  return raw.split(/[\s/]/)[0] || DEFAULT_OS_CONFIG.name
}
