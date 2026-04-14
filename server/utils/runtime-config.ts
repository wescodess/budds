function normalizeString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

export function readConfiguredRuntimeValue(
  configValue: unknown,
  ...envNames: string[]
): string {
  const configuredValue = normalizeString(configValue)
  if (configuredValue) return configuredValue

  for (const envName of envNames) {
    const envValue = normalizeString(process.env[envName])
    if (envValue) return envValue
  }

  return ''
}
