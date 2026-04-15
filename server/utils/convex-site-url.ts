function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

export function toConvexSiteUrl(url: string) {
  if (!url) return ''
  return url.replace(/\.convex\.cloud(?=\/|$)/, '.convex.site')
}

export function getConvexSiteUrl(config: {
  authProxyTargetUrl?: unknown
  convexSiteUrl?: unknown
  public?: {
    convex?: {
      url?: unknown
    }
  }
}) {
  const proxyTargetUrl = normalizeString(config.authProxyTargetUrl)
  if (proxyTargetUrl) return proxyTargetUrl

  const explicitSiteUrl = normalizeString(config.convexSiteUrl)
  if (explicitSiteUrl) return explicitSiteUrl

  const publicConvexUrl = normalizeString(config.public?.convex?.url)
  return toConvexSiteUrl(publicConvexUrl)
}
