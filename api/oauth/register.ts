// RFC 7591 Dynamic Client Registration (sin estado: el client_id es un JWT firmado)
import { json, oauthError, originOf, preflight } from '../_lib/http.js'
import { issueClient, redirectAllowed } from '../_lib/oauth.js'

export function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return oauthError('invalid_client_metadata', 'JSON inválido')
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (uris.length === 0 || uris.length > 5) return oauthError('invalid_redirect_uri', 'Se requieren entre 1 y 5 redirect_uris')
  const bad = uris.filter((u) => !redirectAllowed(u))
  if (bad.length) return oauthError('invalid_redirect_uri', `redirect_uri no permitido: ${bad.join(', ')}`)

  const iss = originOf(req)
  const name = typeof body.client_name === 'string' ? body.client_name : 'Cliente MCP'
  const client_id = await issueClient(iss, uris, name)
  return json(
    {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  )
}
