export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...headers },
  })
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

// Origen publico del despliegue (sirve igual para el dominio propio y para *.vercel.app)
export function originOf(req: Request): string {
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? url.host
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  return `${proto}://${host}`
}

export function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status)
}

export async function readForm(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get('content-type') ?? ''
  const text = await req.text()
  if (type.includes('application/json')) {
    const obj = JSON.parse(text || '{}') as Record<string, unknown>
    return new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)]))
  }
  return new URLSearchParams(text)
}
