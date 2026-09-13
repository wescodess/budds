type UnknownRecord = Record<PropertyKey, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null
    ? value as UnknownRecord
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function getErrorMessage(error: unknown, fallback: string): string {
  const record = asRecord(error)
  const data = asRecord(record?.data)

  return nonEmptyString(data?.message)
    ?? nonEmptyString(record?.message)
    ?? nonEmptyString(error)
    ?? fallback
}

export function getErrorStatusCode(error: unknown): number | undefined {
  const record = asRecord(error)
  const response = asRecord(record?.response)
  const statusCode = record?.statusCode ?? record?.status ?? response?.status
  return typeof statusCode === 'number' && Number.isInteger(statusCode)
    ? statusCode
    : undefined
}
