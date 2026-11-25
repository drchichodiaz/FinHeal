// Token endpoint: authorization_code (con PKCE) y refresh_token
import { json, oauthError, originOf, preflight, readForm } from '../_lib/http.js'
import { sha256b64url, verify } from '../_lib/jwt.js'
import { clientHash, issueTokens, readClient } from '../_lib/oauth.js'

export function OPTIONS() {
  return preflight()
}

export async function POST(req: Request) {
  const iss = originOf(req)
  const f = await readForm(req)
  const grant = f.get('grant_type')
  const clientId = f.get('client_id') ?? ''

  if (!(await readClient(iss, clientId))) return oauthError('invalid_client', 'client_id inválido', 401)
  const cid = await clientHash(clientId)

  if (grant === 'authorization_code') {
    const code = await verify(f.get('code'), 'code', iss)
    if (!code) return oauthError('invalid_grant', 'Código inválido o vencido')
    if (code.cid !== cid) return oauthError('invalid_grant', 'El código no pertenece a este cliente')
    if (code.ru !== f.get('redirect_uri')) return oauthError('invalid_grant', 'redirect_uri no coincide')
    const verifier = f.get('code_verifier') ?? ''
    if (verifier.length < 43 || (await sha256b64url(verifier)) !== code.cc) return oauthError('invalid_grant', 'PKCE inválido')
    return json(await issueTokens(iss, String(code.sub), cid))
  }

  if (grant === 'refresh_token') {
    const rt = await verify(f.get('refresh_token'), 'refresh', iss)
    if (!rt || rt.cid !== cid) return oauthError('invalid_grant', 'Refresh token inválido o vencido')
    return json(await issueTokens(iss, String(rt.sub), cid))
  }

  return oauthError('unsupported_grant_type', 'Solo authorization_code y refresh_token')
}
