export async function fetchAsText(proxyPath: string, url: string): Promise<{ statusLine: string; body: string }> {
  const response = await fetch(`${proxyPath}?url=${encodeURIComponent(url)}`, { method: 'GET' })
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()

  const formatted = formatResponseBody(text, contentType)

  return {
    statusLine: `${response.status} ${response.statusText}`,
    body: formatted,
  }
}

function formatResponseBody(text: string, contentType: string): string {
  const parsed = tryParseJson(text, contentType)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    if ('state' in record && 'result' in record) {
      if (record.state === true) {
        return formatValue(record.result, true)
      }
      if (record.state === false) {
        return `Error: ${formatValue(record.result, false)}`
      }
    }
  }

  if (parsed !== null) {
    return JSON.stringify(parsed, null, 2)
  }

  return text
}

function tryParseJson(text: string, contentType: string): unknown | null {
  const looksLikeJson = contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')
  if (!looksLikeJson) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function formatValue(value: unknown, prettyObject: boolean): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return prettyObject ? JSON.stringify(value, null, 2) : JSON.stringify(value)
}
