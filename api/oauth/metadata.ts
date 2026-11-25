// /.well-known/oauth-authorization-server (RFC 8414) y
// /.well-known/oauth-protected-resource (RFC 9728), via rewrites en vercel.json
import { json, originOf, preflight } from '../_lib/http.js'
import { SCOPE, endpoints } from '../_lib/oauth.js'

export function OPTIONS() {
  return preflight()
}

export function GET(req: Request) {
  const iss = originOf(req)
  const e = endpoints(iss)
  const kind = new URL(req.url).searchParams.get('kind')

  if (kind === 'resource') {
    return json({
      resource: e.resource,
      authorization_servers: [iss],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'FinHeal',
    })
  }

  return json({
    issuer: iss,
    authorization_endpoint: e.authorize,
    token_endpoint: e.token,
    registration_endpoint: e.register,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  })
}
