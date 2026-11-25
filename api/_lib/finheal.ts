// Herramientas MCP de FinHeal. Cada funcion recibe el user_id del token OAuth
// y TODAS las consultas filtran por ese user_id (la service role key salta RLS).
import { BILL_CATEGORY, DEBT_CATEGORY, allCategories, isSobreExpense, newId, normalizePlan, type Bill, type BillRepeat, type Plan } from '../../src/lib/config.js'
import { REPEAT_LABEL, nextDue, planBills, type BillPlan } from '../../src/lib/bills.js'
import { buildStrategy } from '../../src/lib/strategy.js'
import { fromISO, inPeriod, periodFor, shiftPeriod } from '../../src/lib/dates.js'
import { adminDb } from './db.js'

const r2 = (n: number) => Math.round(n * 100) / 100
const ISO = /^\d{4}-\d{2}-\d{2}$/

// Comparacion sin mayusculas ni tildes ("debito" == "Débito")
const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

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
  const q = norm(input)
  const cats = allCategories(plan)
  const found = cats.find((c) => norm(c.id) === q) ?? cats.find((c) => norm(c.label) === q) ?? cats.find((c) => norm(c.label).includes(q))
  if (!found) fail(`Categoría "${input}" no existe. Opciones: ${cats.map((c) => `${c.id} (${c.label})`).join(', ')}`)
  return found!
}

function resolveOption(options: string[], input: unknown, what: string): string {
  if (input === undefined || input === null || input === '') return options[0]
  const q = norm(input)
  const found = options.find((o) => norm(o) === q) ?? options.find((o) => norm(o).includes(q))
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
  const billsPaid = r2(byCat.get(BILL_CATEGORY.id) ?? 0)
  const spent = r2(exp.filter((e) => isSobreExpense(e.category)).reduce((t, e) => t + Number(e.amount), 0))
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
    pagado_programados: billsPaid,
    queda_en_cuenta: r2(income - spent - debt - billsPaid),
    apartar_esta_quincena: r2(planBills(plan.bills, today()).reduce((t, b) => t + b.thisQuincena, 0)),
    pagos_proximos: planBills(plan.bills, today())
      .filter((b) => b.daysLeft <= 60 && b.status !== 'listo')
      .map(billView),
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

  // Pago a deudas: baja el saldo de la deuda indicada (el corte corrige intereses despues)
  let deuda: Record<string, unknown> | null = null
  if (cat.id === DEBT_CATEGORY.id) {
    const debts = plan.goals.filter((g) => g.type === 'deuda')
    const q = norm(args.meta)
    const goal = q ? debts.find((g) => norm(g.kind) === q) ?? debts.find((g) => norm(g.label).includes(q)) : debts.length === 1 ? debts[0] : undefined
    if (goal) {
      const balances = await latestBalances(uid)
      const current = balances.find((b) => b.kind === goal.kind)?.amount ?? goal.initial
      const next = Math.max(0, r2(current - amount))
      check(await adminDb().from('balances').insert({ user_id: uid, kind: goal.kind, amount: next, recorded_on: fecha, note: 'Automático: abono de $' + amount }), 'ajustar deuda')
      deuda = { meta: goal.label, antes: current, ahora: next }
    } else {
      deuda = { aviso: 'No se ajustó ningún saldo. Indica "meta": ' + debts.map((g) => g.kind).join(' o ') }
    }
  }

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
  return { ok: true, id: row.id, guardado: { fecha, monto: amount, categoria: cat.label, metodo: method, nota: note }, sobre, deuda }
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
  const q = norm(args.meta)
  const goal = plan.goals.find((g) => norm(g.kind) === q) ?? plan.goals.find((g) => norm(g.label).includes(q))
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

// ---------- pagos programados ----------

function billView(b: BillPlan) {
  return {
    id: b.bill.id,
    pago: b.bill.label,
    monto: b.bill.amount,
    vence: b.bill.due,
    dias_para_vencer: b.daysLeft,
    repite: REPEAT_LABEL[b.bill.repeat],
    apartado: b.bill.saved,
    falta_apartar: b.remaining,
    quincenas_para_apartar: b.quincenas.map((q) => q.start),
    apartar_por_quincena: b.perQuincena,
    apartar_esta_quincena: b.thisQuincena,
    estado: b.status,
    nota: b.bill.note ?? null,
  }
}

async function savePlanDb(uid: string, plan: Plan) {
  check(await adminDb().from('plans').upsert({ user_id: uid, data: plan, updated_at: new Date().toISOString() }), 'guardar plan')
}

function findBill(plan: Plan, input: unknown): Bill {
  const q = norm(input)
  const found = plan.bills.find((b) => norm(b.id) === q) ?? plan.bills.find((b) => norm(b.label) === q) ?? plan.bills.find((b) => norm(b.label).includes(q))
  if (!found) fail(plan.bills.length ? `Pago "${input}" no existe. Opciones: ${plan.bills.map((b) => b.label).join(', ')}` : 'No hay pagos programados. Crea uno con agendar_pago.')
  return found!
}

const REPEATS: Record<string, BillRepeat> = {
  none: 'none', no: 'none', una: 'none', 'una vez': 'none',
  monthly: 'monthly', mensual: 'monthly', 'cada mes': 'monthly',
  yearly: 'yearly', anual: 'yearly', 'cada ano': 'yearly',
}

async function agendarPago(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const label = String(args.nombre ?? '').trim().slice(0, 60)
  if (!label) fail('nombre es requerido (ej. "Seguro del carro")')
  const amount = amountArg(args.monto)
  if (!args.vence || !ISO.test(String(args.vence))) fail('vence debe tener formato YYYY-MM-DD')
  const due = String(args.vence)
  const repeat = args.repetir === undefined || args.repetir === '' ? undefined : (REPEATS[norm(args.repetir)] ?? fail('repetir debe ser "una vez", "mensual" o "anual"'))
  const note = args.nota ? String(args.nota).slice(0, 200) : undefined
  const existing = plan.bills.find((b) => norm(b.label) === norm(label))
  const bill: Bill = existing
    ? { ...existing, amount, due, repeat: repeat ?? existing.repeat, note: note ?? existing.note }
    : { id: newId('pago'), label, icon: '📅', amount, due, repeat: repeat ?? 'none', saved: 0, note }
  plan.bills = existing ? plan.bills.map((b) => (b.id === bill.id ? bill : b)) : [...plan.bills, bill]
  await savePlanDb(uid, plan)
  return { ok: true, accion: existing ? 'actualizado' : 'creado', ...billView(planBills([bill], today())[0]) }
}

async function verPagos(uid: string) {
  const { plan } = await loadPlan(uid)
  const list = planBills(plan.bills, today())
  return {
    hoy: today(),
    apartar_esta_quincena: r2(list.reduce((t, b) => t + b.thisQuincena, 0)),
    total_apartado: r2(list.reduce((t, b) => t + b.bill.saved, 0)),
    pagos: list.map(billView),
    nota: 'Lo apartado sigue en la cuenta del usuario pero ya no es dinero libre.',
  }
}

async function apartarPago(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const bill = findBill(plan, args.pago)
  const n = Number(args.monto)
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100000) fail('monto debe ser un número distinto de 0 (negativo para devolver lo apartado)')
  const fechaAp = dateArg(args.fecha)
  const prev = bill.savedOn && inPeriod(bill.savedOn, periodFor(fechaAp)) ? (bill.lastSaved ?? 0) : 0
  bill.saved = r2(Math.max(0, bill.saved + n))
  bill.savedOn = fechaAp
  bill.lastSaved = r2(Math.max(0, prev + n))
  await savePlanDb(uid, plan)
  return { ok: true, ...billView(planBills([bill], today())[0]) }
}

async function pagarProgramado(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const bill = findBill(plan, args.pago)
  const amount = args.monto === undefined || args.monto === null ? bill.amount : amountArg(args.monto)
  const method = resolveOption(plan.methods, args.metodo, 'Método')
  const fecha = dateArg(args.fecha)
  const row = check(
    await adminDb().from('expenses').insert({ user_id: uid, amount, category: BILL_CATEGORY.id, method, spent_on: fecha, note: bill.label }).select('id').single(),
    'guardar gasto',
  ) as { id: string }
  const next = nextDue(bill.due, bill.repeat)
  plan.bills = next
    ? plan.bills.map((b) => (b.id === bill.id ? { ...b, due: next, saved: 0, savedOn: undefined, lastSaved: undefined } : b))
    : plan.bills.filter((b) => b.id !== bill.id)
  await savePlanDb(uid, plan)
  return {
    ok: true,
    gasto_id: row.id,
    pagado: { pago: bill.label, monto: amount, metodo: method, fecha },
    apartado_tenia: bill.saved,
    diferencia: r2(bill.saved - amount), // >0 sobro lo apartado; <0 hubo que poner de mas
    siguiente_vencimiento: next,
  }
}

async function borrarPago(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const bill = findBill(plan, args.pago)
  plan.bills = plan.bills.filter((b) => b.id !== bill.id)
  await savePlanDb(uid, plan)
  return { ok: true, borrado: bill.label, tenia_apartado: bill.saved }
}

// ---------- estrategia ----------

async function estrategia(uid: string, args: Record<string, unknown>) {
  const hoy = today()
  const p = periodFor(hoy)
  const n = Math.min(6, Math.max(1, Number(args.quincenas ?? 3) || 3))
  const { plan } = await loadPlan(uid)
  const db = adminDb()
  const exp = check(await db.from('expenses').select('spent_on, amount, category').eq('user_id', uid).gte('spent_on', p.start).lte('spent_on', p.end), 'gastos') as { spent_on: string; amount: number; category: string }[]
  const inc = check(await db.from('incomes').select('received_on, amount, source').eq('user_id', uid).gte('received_on', p.start).lte('received_on', p.end), 'ingresos') as { received_on: string; amount: number; source: string }[]
  const s = buildStrategy(
    {
      plan,
      expenses: exp.map((e) => ({ ...e, amount: Number(e.amount) })),
      incomes: inc.map((i) => ({ ...i, amount: Number(i.amount) })),
      balances: await latestBalances(uid),
    },
    hoy,
  )
  if (!s.ready) return { lista: false, aviso: 'Falta el ingreso por quincena en el plan (pantalla Plan de la app).' }
  return {
    hoy,
    como_funciona:
      'Cascada por quincena: sobres -> cuotas fijas -> apartados de pagos programados -> colchón hasta su meta -> extra a la deuda de mayor tasa -> ahorro. Si no alcanza, sale del colchón. En la quincena actual "hecho" es lo ya registrado (null = no medible).',
    quincenas: s.quincenas.slice(0, n).map((q) => ({
      quincena: q.period.label,
      desde: q.period.start,
      hasta: q.period.end,
      actual: q.current,
      ingreso_que_se_reparte: q.income,
      ingreso_ya_anotado: q.current ? q.received : undefined,
      pasos: q.steps.map((st) => ({ paso: st.label, monto: st.amount, hecho: q.current ? st.done : undefined, fecha: st.date, nota: st.note })),
      faltante: q.deficit,
      deuda_total_al_cierre: q.debtAfter,
      avisos: q.warnings,
    })),
    fechas_proyectadas: {
      deudas: s.debts.map((d) => ({ deuda: d.label, pagada: d.date })),
      ahorros: s.savings.map((d) => ({ meta: d.label, alcanzada: d.date })),
      libre_de_deudas: s.debtFree,
    },
    supuestos: 'Ingreso fijo por quincena, sin décimos ni pagos atrasados de la empresa; intereses de la tarjeta y préstamo incluidos.',
  }
}

// ---------- auditoria de la estrategia (analisis con criterio de Claude) ----------

const GUIA_AUDITORIA = [
  'Eres un asesor financiero revisando la estrategia calculada. El programa aplica reglas fijas; tu trabajo es el criterio que el programa no tiene.',
  '1. Realismo de los sobres: compara el presupuesto con lo gastado de verdad en historial_quincenas. Un sobre que se pasa siempre no es disciplina, es un presupuesto mal hecho: propón subirlo y de dónde sacarlo. Uno que siempre sobra puede bajar.',
  '2. Orden de prioridades: ¿sigue teniendo sentido llenar el colchón antes de la tarjeta? Pondera el costo (tasa de la tarjeta sobre lo que se deja de abonar) contra el riesgo (ingreso inestable, empresa que paga tarde). Usa simular_estrategia para medir la diferencia en fechas antes de opinar.',
  '3. Riesgos y huecos: gastos que se vienen y no están agendados (fin de año, regalos, mantenimiento del carro, matrícula, impuestos, renovaciones anuales). Pagos mínimos sin registrar como cuota. Pagos programados en estado urgente. Quincenas con faltante.',
  '4. Datos desactualizados: saldos de deudas sin actualizar desde hace más de un corte, colchón sin actualizar al cierre, ingresos de la quincena sin anotar.',
  '5. Comportamiento: patrones en los movimientos (gastos hormiga, días o métodos donde se dispara el gasto, salidas sociales). Sé concreto y sin sermones.',
  '6. Oportunidades: dinero por cobrar a la empresa, décimos, ingresos extra; qué hacer con ellos cuando lleguen (simúlalo).',
  'Entrega: (a) veredicto en 1-2 líneas, (b) máximo 5 hallazgos ordenados por impacto, cada uno con número y acción, (c) cambios propuestos al plan con su efecto simulado en fechas. NO apliques cambios con ajustar_plan sin que el usuario diga que sí. Al final guarda la conclusión con guardar_revision para que aparezca en la app.',
].join('\n')

type Cambios = {
  ingreso_quincena?: number
  sobres?: Record<string, number>
  metas?: Record<string, { meta?: number; tasa?: number; cuota?: number; dia_pago?: number; antes_de_deudas?: boolean }>
  meta_abono_quincena?: number
}

// Aplica cambios a una copia del plan. Devuelve el plan nuevo y la lista legible de cambios.
function applyChanges(plan: Plan, c: Cambios): { plan: Plan; cambios: string[] } {
  const next: Plan = structuredClone(plan)
  const out: string[] = []
  const money = (v: unknown, what: string) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 100000) fail(`${what}: monto inválido`)
    return r2(n)
  }
  if (c.ingreso_quincena !== undefined) {
    next.incomePerQuincena = money(c.ingreso_quincena, 'ingreso_quincena')
    out.push(`Ingreso por quincena: ${plan.incomePerQuincena} → ${next.incomePerQuincena}`)
  }
  if (c.meta_abono_quincena !== undefined) {
    next.debtTargetPerQuincena = money(c.meta_abono_quincena, 'meta_abono_quincena')
    out.push(`Meta de abono por quincena: ${plan.debtTargetPerQuincena} → ${next.debtTargetPerQuincena}`)
  }
  for (const [key, val] of Object.entries(c.sobres ?? {})) {
    const cat = next.categories.find((x) => norm(x.id) === norm(key)) ?? next.categories.find((x) => norm(x.label).includes(norm(key)))
    if (!cat) fail(`Sobre "${key}" no existe. Opciones: ${next.categories.map((x) => x.id).join(', ')}`)
    const before = cat!.budget
    cat!.budget = money(val, `sobre ${key}`)
    out.push(`Sobre ${cat!.label}: ${before} → ${cat!.budget}`)
  }
  for (const [key, val] of Object.entries(c.metas ?? {})) {
    const g = next.goals.find((x) => norm(x.kind) === norm(key)) ?? next.goals.find((x) => norm(x.label).includes(norm(key)))
    if (!g) fail(`Meta "${key}" no existe. Opciones: ${next.goals.map((x) => x.kind).join(', ')}`)
    if (val.meta !== undefined) (out.push(`${g!.label} meta: ${g!.target} → ${money(val.meta, 'meta')}`), (g!.target = money(val.meta, 'meta')))
    if (val.tasa !== undefined) (out.push(`${g!.label} tasa: ${g!.rate ?? '-'} → ${money(val.tasa, 'tasa')}`), (g!.rate = money(val.tasa, 'tasa')))
    if (val.cuota !== undefined) (out.push(`${g!.label} cuota/mínimo: ${g!.payment ?? '-'} → ${money(val.cuota, 'cuota')}`), (g!.payment = money(val.cuota, 'cuota') || undefined))
    if (val.dia_pago !== undefined) {
      const d = Math.round(Number(val.dia_pago))
      if (!(d >= 1 && d <= 31)) fail('dia_pago debe estar entre 1 y 31')
      out.push(`${g!.label} día de pago: ${g!.payDay ?? '-'} → ${d}`)
      g!.payDay = d
    }
    if (val.antes_de_deudas !== undefined) (out.push(`${g!.label} antes de deudas: ${!!g!.beforeDebt} → ${!!val.antes_de_deudas}`), (g!.beforeDebt = !!val.antes_de_deudas || undefined))
  }
  if (!out.length) fail('No indicaste ningún cambio')
  return { plan: next, cambios: out }
}

async function strategyInput(uid: string, plan: Plan) {
  const p = periodFor(today())
  const db = adminDb()
  const exp = check(await db.from('expenses').select('spent_on, amount, category').eq('user_id', uid).gte('spent_on', p.start).lte('spent_on', p.end), 'gastos') as { spent_on: string; amount: number; category: string }[]
  const inc = check(await db.from('incomes').select('received_on, amount, source').eq('user_id', uid).gte('received_on', p.start).lte('received_on', p.end), 'ingresos') as { received_on: string; amount: number; source: string }[]
  return {
    plan,
    expenses: exp.map((e) => ({ ...e, amount: Number(e.amount) })),
    incomes: inc.map((i) => ({ ...i, amount: Number(i.amount) })),
    balances: await latestBalances(uid),
  }
}

function milestones(s: ReturnType<typeof buildStrategy>) {
  return {
    deudas: Object.fromEntries(s.debts.map((d) => [d.label, d.date])),
    ahorros: Object.fromEntries(s.savings.map((d) => [d.label, d.date])),
    libre_de_deudas: s.debtFree,
    faltantes_proximas_6: s.quincenas.slice(0, 6).filter((q) => q.deficit > 0).map((q) => ({ quincena: q.period.start, faltante: q.deficit })),
  }
}

async function historialQuincenas(uid: string, args: Record<string, unknown>) {
  const n = Math.min(12, Math.max(1, Number(args.quincenas ?? 6) || 6))
  const { plan } = await loadPlan(uid)
  let p = periodFor(today())
  const periods = [p]
  for (let i = 1; i < n; i++) periods.unshift((p = shiftPeriod(p, -1)))
  const db = adminDb()
  const exp = check(await db.from('expenses').select('spent_on, amount, category, method').eq('user_id', uid).gte('spent_on', periods[0].start).lte('spent_on', periods[periods.length - 1].end), 'gastos') as { spent_on: string; amount: number; category: string; method: string }[]
  const inc = check(await db.from('incomes').select('received_on, amount, source').eq('user_id', uid).gte('received_on', periods[0].start).lte('received_on', periods[periods.length - 1].end), 'ingresos') as { received_on: string; amount: number; source: string }[]
  const cats = allCategories(plan)
  const rows = periods.map((per) => {
    const e = exp.filter((x) => inPeriod(x.spent_on, per))
    const by = (f: (x: (typeof e)[number]) => boolean) => r2(e.filter(f).reduce((t, x) => t + Number(x.amount), 0))
    return {
      quincena: per.start,
      actual: inPeriod(today(), per),
      ingresos: r2(inc.filter((x) => inPeriod(x.received_on, per)).reduce((t, x) => t + Number(x.amount), 0)),
      gastos: e.length,
      sobres: Object.fromEntries(
        cats.map((c) => [c.id, { gastado: by((x) => x.category === c.id), limite: c.budget }]).filter(([, v]) => (v as { gastado: number }).gastado > 0 || (v as { limite: number }).limite > 0),
      ),
      por_metodo: Object.fromEntries([...new Set(e.map((x) => x.method))].map((m) => [m, by((x) => x.method === m)])),
    }
  })
  return { desde: periods[0].start, quincenas: rows, nota: 'Las quincenas anteriores al inicio del plan pueden estar vacías.' }
}

async function auditarEstrategia(uid: string) {
  const { plan } = await loadPlan(uid)
  const input = await strategyInput(uid, plan)
  const s = buildStrategy(input, today())
  if (!s.ready) return { lista: false, aviso: 'Falta el ingreso por quincena en el plan.' }
  const goalsNow = plan.goals.map((g) => {
    const last = input.balances.find((b) => b.kind === g.kind)
    return { id: g.kind, meta: g.label, tipo: g.type, saldo: last?.amount ?? g.initial, actualizado: last?.recorded_on ?? null, objetivo: g.target, tasa: g.rate ?? null, cuota: g.payment ?? null, dia_pago: g.payDay ?? null, antes_de_deudas: !!g.beforeDebt }
  })
  return {
    hoy: today(),
    guia_de_auditoria: GUIA_AUDITORIA,
    estrategia: {
      quincenas: s.quincenas.slice(0, 4).map((q) => ({ quincena: q.period.start, actual: q.current, ingreso: q.income, pasos: q.steps.map((x) => `${x.label}: ${x.amount}${q.current && x.done !== null ? ` (hecho ${x.done})` : ''}`), faltante: q.deficit, avisos: q.warnings })),
      fechas: milestones(s),
    },
    plan: {
      ingreso_quincena: plan.incomePerQuincena,
      sobres: plan.categories.map((c) => ({ id: c.id, sobre: c.label, limite: c.budget })),
      fuentes_de_ingreso: plan.incomeSources,
      reglas: plan.rules,
    },
    metas: goalsNow,
    pagos_programados: planBills(plan.bills, today()).map(billView),
    historial: await historialQuincenas(uid, { quincenas: 6 }),
    revision_anterior: plan.review ?? null,
    herramientas_para_seguir: 'simular_estrategia (probar cambios), listar_movimientos (detalle), ajustar_plan (solo con el sí del usuario), guardar_revision (al final).',
  }
}

async function simularEstrategia(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const input = await strategyInput(uid, plan)
  const base = buildStrategy(input, today())
  const c = (args.cambios ?? {}) as Cambios
  const hasPlanChanges = Object.keys(c).length > 0
  const changed = hasPlanChanges ? applyChanges(plan, c) : { plan, cambios: [] as string[] }
  const extras = ((args.ingresos_extra ?? []) as { fecha?: string; monto?: number }[]).map((x) => {
    if (!x.fecha || !ISO.test(x.fecha)) fail('ingresos_extra: fecha debe ser YYYY-MM-DD')
    return { date: x.fecha!, amount: amountArg(x.monto) }
  })
  if (!hasPlanChanges && !extras.length) fail('Indica cambios o ingresos_extra para simular')
  const sim = buildStrategy({ ...input, plan: changed.plan }, today(), 120, extras)
  return {
    escenario: [...changed.cambios, ...extras.map((x) => `Ingreso extra de ${x.amount} el ${x.date}`)],
    actual: milestones(base),
    simulado: milestones(sim),
    simulado_proximas_quincenas: sim.quincenas.slice(0, 3).map((q) => ({ quincena: q.period.start, pasos: q.steps.map((x) => `${x.label}: ${x.amount}`), faltante: q.deficit })),
    nota: 'Nada se guardó. Para aplicarlo, usa ajustar_plan con los mismos cambios, solo si el usuario lo aprueba.',
  }
}

async function ajustarPlan(uid: string, args: Record<string, unknown>) {
  const { plan } = await loadPlan(uid)
  const input = await strategyInput(uid, plan)
  const before = buildStrategy(input, today())
  const { plan: next, cambios } = applyChanges(plan, (args.cambios ?? {}) as Cambios)
  await savePlanDb(uid, next)
  const after = buildStrategy({ ...input, plan: next }, today())
  return { ok: true, cambios_aplicados: cambios, fechas_antes: milestones(before), fechas_ahora: milestones(after) }
}

async function guardarRevision(uid: string, args: Record<string, unknown>) {
  const summary = String(args.resumen ?? '').trim().slice(0, 400)
  if (!summary) fail('resumen es requerido')
  const points = (Array.isArray(args.puntos) ? args.puntos : []).map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 6)
  const { plan } = await loadPlan(uid)
  plan.review = { date: today(), summary, points }
  await savePlanDb(uid, plan)
  return { ok: true, guardada: plan.review, nota: 'Aparece en Inicio de la app como "Última revisión".' }
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
    name: 'estrategia',
    title: 'Estrategia: qué hacer ahora',
    description: 'Cómo repartir la quincena actual paso a paso (con lo ya hecho y lo pendiente), las próximas quincenas y las fechas proyectadas para pagar cada deuda y llenar cada ahorro. Úsalo cuando el usuario pregunte qué hacer, cuánto abonar, cuánto le queda o cuándo sale de deudas.',
    inputSchema: { type: 'object', properties: { quincenas: { type: 'number', description: 'Cuántas quincenas mostrar desde la actual (1 a 6, por defecto 3)' } } },
    annotations: { readOnlyHint: true },
    run: estrategia,
  },
  {
    name: 'auditar_estrategia',
    title: 'Auditar la estrategia',
    description: 'Úsalo cuando el usuario pida auditar, revisar, analizar o actualizar la estrategia. Devuelve en una sola llamada la estrategia calculada, el plan, las metas con la fecha de su último saldo, los pagos programados, el historial real de las últimas 6 quincenas y una guía de auditoría. Analiza con criterio propio siguiendo la guía; mide alternativas con simular_estrategia antes de recomendarlas.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: (uid) => auditarEstrategia(uid),
  },
  {
    name: 'historial_quincenas',
    title: 'Historial por quincena',
    description: 'Gasto real por sobre contra su límite, ingresos y gasto por método de pago en las últimas N quincenas. Sirve para ver patrones.',
    inputSchema: { type: 'object', properties: { quincenas: { type: 'number', description: '1 a 12, por defecto 6' } } },
    annotations: { readOnlyHint: true },
    run: historialQuincenas,
  },
  {
    name: 'simular_estrategia',
    title: 'Simular cambios a la estrategia',
    description: 'Compara las fechas proyectadas actuales contra un escenario: cambios al plan y/o ingresos extra futuros (ej. décimo, pago atrasado de la empresa). No guarda nada.',
    inputSchema: {
      type: 'object',
      properties: {
        cambios: {
          type: 'object',
          description: 'Cambios hipotéticos al plan',
          properties: {
            ingreso_quincena: { type: 'number' },
            meta_abono_quincena: { type: 'number' },
            sobres: { type: 'object', description: 'id del sobre -> nuevo límite por quincena, ej. {"salidas": 30}', additionalProperties: { type: 'number' } },
            metas: {
              type: 'object',
              description: 'id de la meta -> cambios, ej. {"colchon": {"meta": 300}, "tarjeta": {"cuota": 95, "dia_pago": 28}}',
              additionalProperties: {
                type: 'object',
                properties: { meta: { type: 'number' }, tasa: { type: 'number' }, cuota: { type: 'number' }, dia_pago: { type: 'number' }, antes_de_deudas: { type: 'boolean' } },
              },
            },
          },
        },
        ingresos_extra: {
          type: 'array',
          description: 'Ingresos futuros supuestos',
          items: { type: 'object', required: ['fecha', 'monto'], properties: { fecha: { type: 'string', description: 'YYYY-MM-DD' }, monto: { type: 'number' } } },
        },
      },
    },
    annotations: { readOnlyHint: true },
    run: simularEstrategia,
  },
  {
    name: 'ajustar_plan',
    title: 'Ajustar el plan',
    description: 'Aplica cambios al plan (mismo formato que "cambios" de simular_estrategia) y devuelve las fechas antes y después. SOLO después de que el usuario apruebe explícitamente esos cambios.',
    inputSchema: {
      type: 'object',
      required: ['cambios'],
      properties: { cambios: { type: 'object', description: 'Igual que en simular_estrategia' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: ajustarPlan,
  },
  {
    name: 'guardar_revision',
    title: 'Guardar revisión de la estrategia',
    description: 'Guarda la conclusión de una auditoría para que el usuario la vea en Inicio de la app. Reemplaza la anterior.',
    inputSchema: {
      type: 'object',
      required: ['resumen'],
      properties: {
        resumen: { type: 'string', description: 'Veredicto en 1-2 oraciones (máx. 400 caracteres)' },
        puntos: { type: 'array', items: { type: 'string' }, description: 'Hasta 6 hallazgos o acciones concretas' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: guardarRevision,
  },
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
        categoria: { type: 'string', description: 'id o nombre del sobre (ej. "super", "salidas"). "deuda" = pago a deudas. Para pagos agendados usa pagar_programado.' },
        metodo: { type: 'string', description: 'Método de pago (ej. Efectivo, Yappy, Débito). Si se omite, el primero del plan.' },
        meta: { type: 'string', description: 'Solo si categoria = "deuda": id o nombre de la deuda que se abona (ej. "tarjeta", "prestamo"). Su saldo baja automáticamente.' },
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
    name: 'ver_pagos',
    title: 'Ver pagos programados',
    description: 'Pagos futuros (seguros, matrículas, impuestos...) con su vencimiento, lo apartado, lo que falta y cuánto apartar por quincena. Úsalo para planificar.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: (uid) => verPagos(uid),
  },
  {
    name: 'agendar_pago',
    title: 'Agendar pago programado',
    description: 'Crea (o actualiza, si ya existe con ese nombre) un pago futuro. FinHeal reparte lo que falta entre las quincenas que quedan antes del vencimiento. Úsalo cuando el usuario diga "tengo que pagar X para el día Y". No es un gasto: no lo anotes con anotar_gasto.',
    inputSchema: {
      type: 'object',
      required: ['nombre', 'monto', 'vence'],
      properties: {
        nombre: { type: 'string', description: 'Ej. "Seguro del carro"' },
        monto: { type: 'number', description: 'Monto estimado en dólares (si es aproximado, redondea hacia arriba)' },
        vence: { type: 'string', description: 'Fecha de vencimiento YYYY-MM-DD' },
        repetir: { type: 'string', enum: ['una vez', 'mensual', 'anual'], description: 'Si se repite. Por defecto "una vez".' },
        nota: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: agendarPago,
  },
  {
    name: 'apartar_pago',
    title: 'Apartar dinero para un pago',
    description: 'Registra dinero apartado para un pago programado (sigue en la cuenta, pero ya no es libre). Monto negativo para devolver lo apartado.',
    inputSchema: {
      type: 'object',
      required: ['pago', 'monto'],
      properties: { pago: { type: 'string', description: 'Nombre o id del pago' }, monto: { type: 'number' }, fecha },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: apartarPago,
  },
  {
    name: 'pagar_programado',
    title: 'Marcar pago programado como pagado',
    description: 'Registra el pago como gasto (categoría Pago programado, no cuenta contra los sobres). Si se repite, agenda el siguiente vencimiento; si no, lo quita de la lista.',
    inputSchema: {
      type: 'object',
      required: ['pago'],
      properties: {
        pago: { type: 'string', description: 'Nombre o id del pago' },
        monto: { type: 'number', description: 'Monto real pagado. Si se omite, el monto agendado.' },
        metodo: { type: 'string' },
        fecha,
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: pagarProgramado,
  },
  {
    name: 'borrar_pago',
    title: 'Borrar pago programado',
    description: 'Quita un pago programado de la lista sin registrar gasto. Confirma con el usuario antes de usarlo.',
    inputSchema: { type: 'object', required: ['pago'], properties: { pago: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: borrarPago,
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
    // Los errores de configuracion ("Falta X") solo nombran la variable, nunca su valor
    const config = e instanceof Error && /^Falta [A-Z_]+$/.test(e.message)
    const msg = e instanceof ToolError ? e.message : config ? `Servidor mal configurado: ${(e as Error).message} en Vercel` : 'Error interno del servidor'
    if (!(e instanceof ToolError)) console.error(e)
    return { isError: true, content: [{ type: 'text', text: msg }] }
  }
}
