const DEFAULT_API_HOST = "127.0.0.1"
const DEFAULT_API_PORT = 4000

export function resolveServiceApiUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  if (environment.EXPRESS_API_URL) {
    const url = new URL(environment.EXPRESS_API_URL)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('EXPRESS_API_URL must use http or https')
    }
    if (url.username || url.password) {
      throw new Error('EXPRESS_API_URL must not contain credentials')
    }
    url.pathname = url.pathname.replace(/\/$/, '')
    return url.toString().replace(/\/$/, '')
  }

  const host = environment.API_HOST?.trim() || DEFAULT_API_HOST
  const rawPort = environment.API_PORT ?? String(DEFAULT_API_PORT)
  const port = Number(rawPort)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid API_PORT: ${rawPort}. Expected an integer from 1 to 65535.`)
  }

  const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
  return `http://${urlHost}:${port}`
}
