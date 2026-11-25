// Herramientas MCP de FinHeal. Cada funcion recibe el user_id del token OAuth
// y TODAS las consultas filtran por ese user_id (la service role key salta RLS).
import { DEBT_CATEGORY, allCategories, normalizePlan, type Plan } from '../../src/lib/config.js'
import { fromISO, inPeriod, periodFor } from '../../src/lib/dates.js'
import { adminDb } from './db.js'

const r2 = (n: number) => Math.round(n * 100) / 100
const ISO = /^\d{4}-\d{2}-\d{2}$/

export function today(): string {
  const tz = process.env.APP_TZ || 'UTC'
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg)
}

function dateArg(v: unknown, name = 'fecha'): string {
  if (v === undefined || v === null || v === '') return today()
  const s = String(v)
  if (!ISO.test(s)) fail(`${name} debe tener formato YYYY-MM-DD`)
  return s
}

function amountArg(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 100000) fail('monto debe ser un número mayor que 0')
  return r2(n)
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) fail(`${what}: ${res.error.message}`)
  return res.data
}

async function loadPlan(uid: string): Promise<{ plan: Plan; hasPlan: boolean }> {
  const row = check(await adminDb().from('plans').select('data').eq('user_id', uid).maybeSingle(), 'plan')
  return { plan: normalizePlan((row?.data ?? null) as Partial<Plan> | null), hasPlan: !!row }
}

async function latestBalances(uid: string) {
  const rows = check(
    await adminDb().from('balances').select('kind, amount, recorded_on, note').eq('user_id', uid).order('recorded_on', { ascending: false }).order('created_at', { ascending: false }),
    'saldos',
  ) as { kind: string; amount: number; recorded_on: string; note: string | null }[]
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

function resolveCategory(plan: Plan, input: unknown) {
  const q = String(input ?? '').trim().toLowerCase()
  const cats = allCategories(plan)
  const found = cats.find((c) => c.id.toLowerCase() === q) ?? cats.find((c) => c.label.toLowerCase() === q) ?? cats.find((c) => c.label.toLowerCase().includes(q))
  if (!found) fail(`Categoría "${input}" no existe. Opciones: ${cats.map((c) => `${c.id} (${c.label})`).join(', ')}`)
  return found!
}

function resolveOption(options: string[], input: unknown, what: string): string {
  if (input === undefined || input === null || input === '') return options[0]
  const q = String(input).trim().toLowerCase()
  const found = options.find((o) => o.toLowerCase() === q) ?? options.find((o) => o.toLowerCase().includes(q))
  if (!found) fail(`${what} "${input}" no existe. Opciones: ${options.join(', ')}`)
  return found!
}

// ---------- herramientas ----------

async function resumenQuincena(uid: string, args: Record<string, unknown>) {
  const ref = dateArg(args.fecha)
  const period = periodFor(ref)
  const { plan, hasPlan } = await loadPlan(uid)
  const db = adminDb()
  const exp = check(
    await db.from('expenses').select('spent_on, amount, category').eq('user_id', uid).gte('spent_on', period.start).lte('spent_on', period.end),
    'gastos',
  ) as { spent_on: string; amount: number; category: string }[]
  const inc = check(
    await db.from('incomes').select('received_on, amount, source').eq('user_id', uid).gte('received_on', period.start).lte('received_on', period.end),
    'ingresos',
  ) as { amount: number; source: string }[]

  const byCat = new Map<string, number>()
  for (const e of exp) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount))
  const income = r2(inc.reduce((t, i) => t + Number(i.amount), 0))
  const debt = r2(byCat.get(DEBT_CATEGORY.id) ?? 0)
  const spent = r2(exp.filter((e) => e.category !== DEBT_CATEGORY.id).reduce((t, e) => t + Number(e.amount), 0))
  const isCurrent = inPeriod(today(), period)

  return {
    quincena: period.label,
    desde: period.start,
    hasta: period.end,
    hoy: today(),
    dias_restantes: isCurrent ? Math.round((fromISO(period.end).getTime() - fromISO(today()).getTime()) / 86400000) + 1 : 0,
    plan_configurado: hasPlan,
    ingresos: income,
    gastado_en_sobres: spent,
    abonado_a_deudas: debt,
    meta_abono_deudas: plan.debtTargetPerQuincena,
    queda_en_cuenta: r2(income - spent - debt),
    presupuesto_total_sobres: r2(plan.categories.reduce((t, c) => t + c.budget, 0)),
    sobres: plan.categories
      .filter((c) => c.budget > 0)
      .map((c) => {
        const v = r2(byCat.get(c.id) ?? 0)
        return { id: c.id, sobre: c.label, gastado: v, limite: c.budget, disponible: r2(c.budget - v), estado: v > c.budget ? 'pasado' : v >= c.budget * 0.8 ? 'casi' : 'ok' }
      }),
    reglas: plan.rules,
    movimientos_en_quincena: exp.length + inc.length,
  }
}

async function listarMovimientos(uid: string, args: Record<string, unknown>) {
  const hasta = dateArg(args.hasta, 'hasta')
  const desde = args.desde ? dateArg(args.desde, 'desde') : periodFor(hasta).start
  const limite = Math.min(200, Math.max(1, Number(args.limite ?? 100) || 100))
  const { plan } = await loadPlan(uid)
  const cats = new Map(allCategories(plan).map((c) => [c.id, c.label]))
  const db = adminDb()
  const exp = check(
    await db.from('expenses').select('id, spent_on, amount, category, method, note').eq('user_id', uid).gte('spent_on', desde).lte('spent_on', hasta).order('spent_on', { ascending: false }).limit(limite),
    'gastos',
  ) as { id: string; spent_on: string; amount: number; category: string; method: string; note: string | null }[]
  const inc = check(
    await db.from('incomes').select('id, received_on, amount, source, note').eq('user_id', uid).gte('received_on', desde).lte('received_on', hasta).order('received_on', { ascending: false }).limit(limite),
    'ingresos',
  ) as { id: string; received_on: string; amount: number; source: string; note: string | null }[]
  return {
    desde,
    hasta,
    gastos: exp.map((e) => ({ id: e.id, fecha: e.spent_on, monto: Number(e.amount), categoria: cats.get(e.category) ?? e.category, metodo: e.method, nota: e.note })),
    ingresos: inc.map((i) => ({ id: i.id, fecha: i.received_on, monto: Number(i.amount), fuente: i.source, nota: i.note })),
  }
}

async function anotarGasto(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const cat = resolveCategory(plan, args.categoria)
  const method = resolveOption(plan.methods, args.metodo, 'Método')
  const amount = amountArg(args.monto)
  const fecha = dateArg(args.fecha)
  const note = args.nota ? String(args.nota).slice(0, 200) : null
  const row = check(
    await adminDb().from('expenses').insert({ user_id: uid, amount, category: cat.id, method, spent_on: fecha, note }).select('id').single(),
    'guardar gasto',
  ) as { id: string }

  let sobre: Record<string, unknown> | null = null
  if (cat.budget > 0) {
    const p = periodFor(fecha)
    const rows = check(
      await adminDb().from('expenses').select('amount').eq('user_id', uid).eq('category', cat.id).gte('spent_on', p.start).lte('spent_on', p.end),
      'sobre',
    ) as { amount: number }[]
    const used = r2(rows.reduce((t, x) => t + Number(x.amount), 0))
    sobre = { sobre: cat.label, gastado: used, limite: cat.budget, disponible: r2(cat.budget - used), pasado: used > cat.budget }
  }
  return { ok: true, id: row.id, guardado: { fecha, monto: amount, categoria: cat.label, metodo: method, nota: note }, sobre }
}

async function anotarIngreso(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const source = resolveOption(plan.incomeSources, args.fuente, 'Fuente')
  const amount = amountArg(args.monto)
  const fecha = dateArg(args.fecha)
  const note = args.nota ? String(args.nota).slice(0, 200) : null
  const row = check(
    await adminDb().from('incomes').insert({ user_id: uid, amount, source, received_on: fecha, note }).select('id').single(),
    'guardar ingreso',
  ) as { id: string }

  // Metas "por cobrar" que bajan solas con esta fuente de ingreso
  const ajustes = []
  const linked = plan.goals.filter((g) => g.reducedBySource === source)
  if (linked.length) {
    const balances = await latestBalances(uid)
    for (const g of linked) {
      const current = balances.find((b) => b.kind === g.kind)?.amount ?? g.initial
      const next = Math.max(0, r2(current - amount))
      check(await adminDb().from('balances').insert({ user_id: uid, kind: g.kind, amount: next, recorded_on: fecha, note: `Automático: ingreso "${source}"` }), 'ajustar meta')
      ajustes.push({ meta: g.label, antes: current, ahora: next })
    }
  }
  return { ok: true, id: row.id, guardado: { fecha, monto: amount, fuente: source, nota: note }, metas_ajustadas: ajustes }
}

async function verMetas(uid: string) {
  const { plan } = await loadPlan(uid)
  const balances = await latestBalances(uid)
  const metas = plan.goals.map((g) => {
    const hist = balances.filter((b) => b.kind === g.kind)
    const actual = hist[0]?.amount ?? g.initial
    const owed = g.type !== 'ahorro'
    const avance = owed ? (g.initial > 0 ? (g.initial - actual) / g.initial : 0) : g.target > 0 ? actual / g.target : 0
    return {
      id: g.kind,
      meta: g.label,
      tipo: g.type,
      inicial: g.initial,
      actual,
      objetivo: g.target,
      avance_pct: Math.round(Math.max(0, Math.min(1, avance)) * 100),
      nota: g.hint,
      historial: hist.slice(0, 6).map((h) => ({ fecha: h.recorded_on, saldo: h.amount, nota: h.note })),
    }
  })
  const deuda_total = r2(metas.filter((m) => m.tipo === 'deuda').reduce((t, m) => t + m.actual, 0))
  return { deuda_total, metas }
}

async function actualizarMeta(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const q = String(args.meta ?? '').trim().toLowerCase()
  const goal = plan.goals.find((g) => g.kind.toLowerCase() === q) ?? plan.goals.find((g) => g.label.toLowerCase().includes(q))
  if (!goal) fail(`Meta "${args.meta}" no existe. Opciones: ${plan.goals.map((g) => `${g.kind} (${g.label})`).join(', ')}`)
  const saldo = Number(args.saldo)
  if (!Number.isFinite(saldo) || saldo < 0) fail('saldo debe ser un número mayor o igual a 0')
  const fecha = dateArg(args.fecha)
  check(
    await adminDb().from('balances').insert({ user_id: uid, kind: goal!.kind, amount: r2(saldo), recorded_on: fecha, note: args.nota ? String(args.nota).slice(0, 200) : null }),
    'guardar saldo',
  )
  return { ok: true, meta: goal!.label, saldo: r2(saldo), fecha }
}

async function borrarMovimiento(uid: string, args: Record<string, unknown>) {
  const table = args.tipo === 'ingreso' ? 'incomes' : args.tipo === 'gasto' ? 'expenses' : fail('tipo debe ser "gasto" o "ingreso"')
  const id = String(args.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail('id inválido (usa listar_movimientos para obtenerlo)')
  const rows = check(await adminDb().from(table as string).delete().eq('user_id', uid).eq('id', id).select('id'), 'borrar') as unknown[]
  if (!rows.length) fail('No encontré ese movimiento')
  return { ok: true, borrado: id }
}

async function verPlan(uid: string) {
  const { plan, hasPlan } = await loadPlan(uid)
  return { plan_configurado: hasPlan, ...plan, categorias_validas: allCategories(plan).map((c) => ({ id: c.id, nombre: c.label, limite_quincena: c.budget })) }
}

// ---------- definicion MCP ----------

type Tool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean | string>
  run: (uid: string, args: Record<string, unknown>) => Promise<unknown>
}

const fecha = { type: 'string', description: 'Fecha YYYY-MM-DD. Si se omite, hoy.' }

export const TOOLS: Tool[] = [
  {
    name: 'resumen_quincena',
    title: 'Resumen de la quincena',
    description: 'Estado de la quincena (del 15 al 29, o del 30 al 14): ingresos, gastos por sobre contra su límite, abono a deudas y cuánto queda. Úsalo para el check diario.',
    inputSchema: { type: 'object', properties: { fecha: { ...fecha, description: 'Cualquier fecha dentro de la quincena a consultar. Si se omite, la actual.' } } },
    annotations: { readOnlyHint: true },
    run: resumenQuincena,
  },
  {
    name: 'listar_movimientos',
    title: 'Listar movimientos',
    description: 'Lista gastos e ingresos (con su id) en un rango de fechas. Por defecto, la quincena actual.',
    inputSchema: {
      type: 'object',
      properties: { desde: { type: 'string', description: 'YYYY-MM-DD' }, hasta: { type: 'string', description: 'YYYY-MM-DD (por defecto hoy)' }, limite: { type: 'number' } },
    },
    annotations: { readOnlyHint: true },
    run: listarMovimientos,
  },
  {
    name: 'anotar_gasto',
    title: 'Anotar gasto',
    description: 'Registra un gasto. Devuelve cuánto queda en ese sobre. Usa ver_plan si no sabes las categorías o métodos válidos.',
    inputSchema: {
      type: 'object',
      required: ['monto', 'categoria'],
      properties: {
        monto: { type: 'number', description: 'Monto en dólares' },
        categoria: { type: 'string', description: 'id o nombre del sobre (ej. "super", "salidas"). "deuda" = pago a deudas.' },
        metodo: { type: 'string', description: 'Método de pago (ej. Efectivo, Yappy, Débito). Si se omite, el primero del plan.' },
        fecha,
        nota: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: anotarGasto,
  },
  {
    name: 'anotar_ingreso',
    title: 'Anotar ingreso',
    description: 'Registra un ingreso (quincena, décimo, reembolso, etc.). Si la fuente está ligada a una meta "por cobrar", la baja automáticamente.',
    inputSchema: {
      type: 'object',
      required: ['monto', 'fuente'],
      properties: { monto: { type: 'number' }, fuente: { type: 'string', description: 'Tipo de ingreso según el plan' }, fecha, nota: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: anotarIngreso,
  },
  {
    name: 'ver_metas',
    title: 'Ver metas y deudas',
    description: 'Saldo actual de cada deuda, ahorro y cuenta por cobrar, con avance e historial reciente.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: verMetas,
  },
  {
    name: 'actualizar_meta',
    title: 'Actualizar saldo de una meta',
    description: 'Registra el saldo actual de una deuda o ahorro (ej. después del corte de la tarjeta).',
    inputSchema: {
      type: 'object',
      required: ['meta', 'saldo'],
      properties: { meta: { type: 'string', description: 'id o nombre de la meta' }, saldo: { type: 'number' }, fecha, nota: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: actualizarMeta,
  },
  {
    name: 'borrar_movimiento',
    title: 'Borrar movimiento',
    description: 'Borra un gasto o ingreso por id (obténlo con listar_movimientos). Confirma con el usuario antes de usarlo.',
    inputSchema: {
      type: 'object',
      required: ['tipo', 'id'],
      properties: { tipo: { type: 'string', enum: ['gasto', 'ingreso'] }, id: { type: 'string' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: borrarMovimiento,
  },
  {
    name: 'ver_plan',
    title: 'Ver plan',
    description: 'Sobres con su límite por quincena, métodos de pago, tipos de ingreso, metas y reglas del plan.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: (uid) => verPlan(uid),
  },
]

export async function callTool(uid: string, name: string, args: Record<string, unknown>) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { isError: true, content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }] }
  try {
    const result = await tool.run(uid, args ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] }
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'Error interno del servidor'
    if (!(e instanceof ToolError)) console.error(e)
    return { isError: true, content: [{ type: 'text', text: msg }] }
  }
}
