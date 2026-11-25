import { sha256b64url, sign, verify } from './jwt.js'

export const ACCESS_TTL = 60 * 60 // 1 hora
export const REFRESH_TTL = 60 * 60 * 24 * 90 // 90 dias
export const CODE_TTL = 5 * 60 // 5 minutos
export const CLIENT_TTL = 60 * 60 * 24 * 365 * 5 // 5 anos
export const SCOPE = 'finheal'

export const endpoints = (iss: string) => ({
  authorize: `${iss}/api/oauth/authorize`,
  token: `${iss}/api/oauth/token`,
  register: `${iss}/api/oauth/register`,
  resource: `${iss}/api/mcp`,
  resourceMetadata: `${iss}/.well-known/oauth-protected-resource`,
})

// Solo se aceptan callbacks de Claude y de localhost (para probar con MCP Inspector)
export function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:' && ['claude.ai', 'claude.com', 'www.claude.ai', 'www.claude.com'].includes(u.hostname)) return true
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return true
    return false
  } catch {
    return false
  }
}

export type Client = { redirectUris: string[]; name: string }

export async function issueClient(iss: string, redirectUris: string[], name: string): Promise<string> {
  return sign('client', iss, CLIENT_TTL, { ru: redirectUris, n: name.slice(0, 80) })
}

export async function readClient(iss: string, clientId: string | null): Promise<Client | null> {
  const c = await verify(clientId, 'client', iss)
  if (!c || !Array.isArray(c.ru)) return null
  return { redirectUris: c.ru as string[], name: String(c.n ?? 'Cliente') }
}

export const clientHash = (clientId: string) => sha256b64url(clientId)

export async function issueTokens(iss: string, sub: string, cid: string) {
  const access_token = await sign('access', iss, ACCESS_TTL, { sub, cid, aud: endpoints(iss).resource, scope: SCOPE })
  const refresh_token = await sign('refresh', iss, REFRESH_TTL, { sub, cid })
  return { access_token, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token, scope: SCOPE }
}

// Devuelve el user_id si el bearer token es valido para este recurso
export async function authenticate(req: Request, iss: string): Promise<string | null> {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  const claims = await verify(m?.[1], 'access', iss)
  if (!claims || claims.aud !== endpoints(iss).resource || typeof claims.sub !== 'string') return null
  return claims.sub
}
