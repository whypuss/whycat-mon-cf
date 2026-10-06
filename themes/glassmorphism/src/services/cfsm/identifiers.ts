const SERVER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

export function normalizeServerId(value: string): string | null {
  const normalized = value.trim()
  return SERVER_ID_PATTERN.test(normalized) ? normalized : null
}
