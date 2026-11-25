// Pantalla de autorizacion: el usuario entra con su correo y contrasena de FinHeal
// y Claude recibe un codigo de un solo uso (PKCE S256 obligatorio).
import { checkPassword } from '../_lib/db.js'
import { originOf, readForm } from '../_lib/http.js'
import { sign } from '../_lib/jwt.js'
import { CODE_TTL, clientHash, readClient } from '../_lib/oauth.js'

const FIELDS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function page(body: string, status = 200): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FinHeal · Autorizar</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:24px}
.card{width:100%;max-width:380px}.logo{font-size:44px;text-align:center}h1{text-align:center;margin:8px 0 4px;font-size:24px}
p{color:#64748b;font-size:14px;text-align:center;margin:0 0 20px}.who{background:#ecfdf5;color:#065f46;border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:16px}
input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;margin-bottom:12px}input:focus{outline:none;border-color:#10b981}
button{width:100%;padding:13px;border:0;border-radius:12px;background:#059669;color:#fff;font-weight:600;font-size:16px}
.err{color:#e11d48;font-size:14px;margin:0 0 12px;text-align:left}.small{font-size:12px;color:#94a3b8;margin-top:14px}
</style></head><body><div class="card"><div class="logo">🌱</div><h1>FinHeal</h1>${body}</div></body></html>`
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com https://www.claude.ai https://www.claude.com http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    },
  })
}

function errorPage(msg: string) {
  return page(`<p>No se puede autorizar esta conexión.</p><p class="err">${esc(msg)}</p>`, 400)
}

type Params = Record<(typeof FIELDS)[number], string>

async function validate(req: Request, src: URLSearchParams): Promise<{ p: Params; clientName: string } | { error: string }> {
  const p = Object.fromEntries(FIELDS.map((f) => [f, src.get(f) ?? ''])) as Params
  const client = await readClient(originOf(req), p.client_id)
  if (!client) return { error: 'Cliente desconocido.' }
  if (!client.redirectUris.includes(p.redirect_uri)) return { error: 'redirect_uri no registrado.' }
  if (p.response_type !== 'code') return { error: 'response_type debe ser "code".' }
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return { error: 'Se requiere PKCE con S256.' }
  return { p, clientName: client.name }
}

function form(p: Params, clientName: string, error?: string) {
  const hidden = FIELDS.map((f) => `<input type="hidden" name="${f}" value="${esc(p[f])}">`).join('')
  return page(`<p>Inicia sesión para conectar tu cuenta.</p>
<div class="who"><b>${esc(clientName)}</b> quiere leer y anotar tus gastos, ingresos y metas.</div>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post">${hidden}
<input type="email" name="email" placeholder="Correo" autocomplete="email" required>
<input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" required>
<button>Autorizar</button></form>
<p class="small">Puedes revocar el acceso desconectando el conector en Claude.</p>`)
}

export async function GET(req: Request) {
  const v = await validate(req, new URL(req.url).searchParams)
  if ('error' in v) return errorPage(v.error)
  return form(v.p, v.clientName)
}

export async function POST(req: Request) {
  const body = await readForm(req)
  const v = await validate(req, body)
  if ('error' in v) return errorPage(v.error)
  const { p, clientName } = v

  const email = body.get('email') ?? ''
  const password = body.get('password') ?? ''
  const user = email && password ? await checkPassword(email, password) : null
  if (!user) return form(p, clientName, 'Correo o contraseña incorrectos.')

  const iss = originOf(req)
  const code = await sign('code', iss, CODE_TTL, {
    sub: user.id,
    cid: await clientHash(p.client_id),
    ru: p.redirect_uri,
    cc: p.code_challenge,
  })
  const target = new URL(p.redirect_uri)
  target.searchParams.set('code', code)
  if (p.state) target.searchParams.set('state', p.state)
  target.searchParams.set('iss', iss)
  return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store' } })
}
