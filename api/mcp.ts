// Servidor MCP de FinHeal (transporte Streamable HTTP, modo sin estado: cada POST
// recibe JSON-RPC y responde JSON). Protegido con OAuth 2.1 (ver api/oauth/*).
import { callTool, TOOLS } from './_lib/finheal.js'
import { CORS, json, originOf, preflight } from './_lib/http.js'
import { authenticate, endpoints } from './_lib/oauth.js'

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const INSTRUCTIONS =
  'FinHeal es el registro de gastos personales del usuario con sobres por quincena (del 15 al 29 y del 30 al 14). ' +
  'Para un check diario usa resumen_quincena. Para "qué hago", cuánto abonar o cuándo sale de deudas, usa estrategia (se recalcula con los datos reales). Antes de anotar, si dudas de la categoría o método, usa ver_plan. ' +
  'Si el usuario menciona un pago futuro ("tengo que pagar X para el Y"), agéndalo con agendar_pago en vez de anotarlo como gasto; ' +
  'el resumen de quincena incluye cuánto apartar para esos pagos. ' +
  'Montos en dólares. Confirma con el usuario antes de borrar.'

function unauthorized(req: Request) {
  const meta = endpoints(originOf(req)).resourceMetadata
  return json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Se requiere autorización' } },
    401,
    { 'WWW-Authenticate': `Bearer resource_metadata="${meta}", scope="finheal"` },
  )
}

async function handle(uid: string, msg: RpcRequest) {
  const { id, method, params } = msg
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

  switch (method) {
    case 'initialize': {
      const asked = String(params?.protocolVersion ?? '')
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'finheal', title: 'FinHeal', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ run: _run, ...t }) => t) })
    case 'tools/call': {
      const name = String(params?.name ?? '')
      const args = (params?.arguments ?? {}) as Record<string, unknown>
      return ok(await callTool(uid, name, args))
    }
    case 'resources/list':
      return ok({ resources: [] })
    case 'prompts/list':
      return ok({ prompts: [] })
    default:
      return err(-32601, `Método no soportado: ${method}`)
  }
}

export function OPTIONS() {
  return preflight()
}

// Sin stream SSE del servidor en modo sin estado
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST' } })
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST' } })
}

export async function POST(req: Request) {
  const uid = await authenticate(req, originOf(req))
  if (!uid) return unauthorized(req)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }, 400)
  }

  const batch = Array.isArray(body) ? (body as RpcRequest[]) : [body as RpcRequest]
  const results = []
  for (const msg of batch) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      results.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Solicitud inválida' } })
      continue
    }
    // Notificaciones (sin id) no llevan respuesta
    if (msg.id === undefined || msg.id === null) continue
    results.push(await handle(uid, msg))
  }

  if (results.length === 0) return new Response(null, { status: 202, headers: CORS })
  return json(Array.isArray(body) ? results : results[0])
}
