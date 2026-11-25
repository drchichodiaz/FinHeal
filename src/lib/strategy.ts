// Motor de estrategia: reparte cada quincena en cascada y proyecta hasta salir de deudas.
// Funcion pura: la usan la app (Inicio) y el conector MCP (herramienta `estrategia`).
//
// Orden de la cascada en cada quincena:
//   1. Sobres (lo ya gastado de mas tambien cuenta)
//   2. Cuotas fijas de deudas que se cobran en esa quincena
//   3. Apartados para pagos programados
//   4. Metas de ahorro "antes de deudas" (colchon) hasta su meta
//   5. Extra a la deuda de mayor tasa (avalancha), y si se paga, a la siguiente
//   6. Lo que sobre, a las demas metas de ahorro (ej. terreno)
// Si no alcanza, el faltante sale del colchon.
import { DEBT_CATEGORY, isSobreExpense, type Bill, type Goal, type Plan } from './config.js'
import { nextDue, planBill } from './bills.js'
import { fromISO, inPeriod, periodFor, shiftPeriod, toISO, type Period } from './dates.js'

const DAY = 86400000
const r2 = (n: number) => Math.round(n * 100) / 100
const sum = (xs: number[]) => r2(xs.reduce((t, x) => t + x, 0))
const days = (a: string, b: string) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / DAY)

export type StratInput = {
  plan: Plan
  expenses: { spent_on: string; amount: number; category: string }[]
  incomes: { received_on: string; amount: number; source: string }[]
  balances: { kind: string; amount: number; recorded_on: string; note: string | null }[] // mas reciente primero
}

export type StepKind = 'sobres' | 'cuota' | 'pago' | 'colchon' | 'extra' | 'ahorro'

export type Step = {
  key: string
  kind: StepKind
  icon: string
  label: string
  amount: number // lo que la estrategia asigna (negativo = sale de ahi)
  done: number | null // lo que ya se hizo en la quincena actual (null = no se puede medir)
  date?: string
  note?: string
}

export type QuincenaPlan = {
  period: Period
  current: boolean
  start: boolean // quincena en que empezo el plan: presupuesto proporcional a los dias
  expected: number // salario esperado que falta o llego
  received: number // ingresos ya anotados
  income: number // lo que se reparte
  steps: Step[]
  free: number // sin asignar (solo si todas las metas estan cumplidas)
  debtAfter: number // deuda total proyectada al cerrar la quincena
  deficit: number // lo que falto y salio del colchon
  warnings: string[]
}

export type Milestone = { kind: string; label: string; icon: string; date: string | null }

export type Strategy = {
  ready: boolean // false si el plan no tiene ingreso por quincena
  quincenas: QuincenaPlan[] // la actual primero, luego las siguientes
  debts: Milestone[] // fecha en que queda pagada cada deuda
  savings: Milestone[] // fecha en que se alcanza cada meta de ahorro
  debtFree: string | null
}

type State = { bal: Map<string, number>; bills: Bill[] }

function latest(input: StratInput, g: Goal): number {
  const row = input.balances.find((b) => b.kind === g.kind)
  return row ? Number(row.amount) : g.initial
}

// Dia de cobro dentro de la quincena (el 31 en un mes de 30 cae el 30)
function payDate(p: Period, day: number): string | null {
  const d = fromISO(p.start)
  while (toISO(d) <= p.end) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    if (d.getDate() === Math.min(day, last)) return toISO(d)
    d.setDate(d.getDate() + 1)
  }
  return null
}

// Abonos registrados a una deuda en la quincena (la app y el conector dejan "Automático: abono de $X")
function paidTo(input: StratInput, kind: string, p: Period): number {
  let t = 0
  for (const b of input.balances) {
    if (b.kind !== kind || !inPeriod(b.recorded_on, p)) continue
    const m = /abono de \$?\s*([\d.,]+)/i.exec(b.note ?? '')
    if (m) t += Number(m[1].replace(/,/g, '')) || 0
  }
  return r2(t)
}

const debtTotal = (plan: Plan, st: State) => sum(debtsOf(plan).map((g) => st.bal.get(g.kind) ?? 0))
const debtsOf = (plan: Plan) => plan.goals.filter((g) => g.type === 'deuda')
const cushionsOf = (plan: Plan) => plan.goals.filter((g) => g.type === 'ahorro' && g.beforeDebt)
const savingsOf = (plan: Plan) => plan.goals.filter((g) => g.type === 'ahorro' && !g.beforeDebt)

// Avalancha: mayor tasa primero; empate, menor saldo
function avalanche(plan: Plan, st: State): Goal[] {
  return debtsOf(plan)
    .filter((g) => (st.bal.get(g.kind) ?? 0) > 0.005)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || (st.bal.get(a.kind) ?? 0) - (st.bal.get(b.kind) ?? 0))
}

// Pasos 4-6 sobre el dinero libre. Modifica el estado.
function cascade(plan: Plan, free: number, st: State, merge: Step[]): { steps: Step[]; free: number } {
  const steps: Step[] = []
  const add = (s: Step) => {
    const prev = merge.find((m) => m.key === s.key)
    if (prev) prev.amount = r2(prev.amount + s.amount)
    else steps.push(s)
  }
  for (const g of cushionsOf(plan)) {
    if (free <= 0) break
    const a = r2(Math.min(free, Math.max(0, g.target - (st.bal.get(g.kind) ?? 0))))
    if (a <= 0) continue
    st.bal.set(g.kind, r2((st.bal.get(g.kind) ?? 0) + a))
    free = r2(free - a)
    add({ key: 'colchon-' + g.kind, kind: 'colchon', icon: g.icon, label: `Al ${g.label.toLowerCase()}`, amount: a, done: null })
  }
  for (const g of avalanche(plan, st)) {
    if (free <= 0) break
    const a = r2(Math.min(free, st.bal.get(g.kind) ?? 0))
    st.bal.set(g.kind, r2((st.bal.get(g.kind) ?? 0) - a))
    free = r2(free - a)
    add({ key: 'extra-' + g.kind, kind: 'extra', icon: g.icon, label: `Abono extra a ${g.label}`, amount: a, done: null })
  }
  for (const g of savingsOf(plan)) {
    if (free <= 0) break
    const need = g.target > 0 ? g.target - (st.bal.get(g.kind) ?? 0) : free
    const a = r2(Math.min(free, Math.max(0, need)))
    if (a <= 0) continue
    st.bal.set(g.kind, r2((st.bal.get(g.kind) ?? 0) + a))
    free = r2(free - a)
    add({ key: 'ahorro-' + g.kind, kind: 'ahorro', icon: g.icon, label: `A ${g.label}`, amount: a, done: null })
  }
  return { steps, free }
}

// Si falta dinero, sale del colchon (y se avisa)
function coverDeficit(plan: Plan, free: number, st: State, steps: Step[]): number {
  if (free >= 0) return 0
  let need = -free
  for (const g of cushionsOf(plan)) {
    const have = st.bal.get(g.kind) ?? 0
    const take = r2(Math.min(have, need))
    if (take <= 0) continue
    st.bal.set(g.kind, r2(have - take))
    need = r2(need - take)
    steps.push({ key: 'colchon-' + g.kind, kind: 'colchon', icon: g.icon, label: `Sale del ${g.label.toLowerCase()}`, amount: -take, done: null })
  }
  return r2(-free)
}

function billSteps(st: State, p: Period, today: string, current: boolean): Step[] {
  const steps: Step[] = []
  // Pagos ya vencidos: si se repiten, pasan al siguiente vencimiento
  st.bills = st.bills.flatMap((b) => {
    if (b.due >= p.start) return [b]
    const next = nextDue(b.due, b.repeat)
    return next ? [{ ...b, due: next, saved: 0, savedOn: undefined, lastSaved: undefined }] : []
  })
  for (const b of st.bills) {
    const bp = planBill(b, current ? today : p.start)
    const before = current && b.savedOn && inPeriod(b.savedOn, p) ? (b.lastSaved ?? 0) : 0
    const amount = r2(before + bp.thisQuincena)
    if (amount <= 0) continue
    b.saved = r2(b.saved + bp.thisQuincena)
    if (bp.thisQuincena > 0) {
      b.savedOn = p.start
      b.lastSaved = amount
    }
    steps.push({ key: 'pago-' + b.id, kind: 'pago', icon: b.icon, label: `Apartar para ${b.label}`, amount, done: current ? before : null, date: b.due, note: `vence ${b.due}` })
  }
  return steps
}

function cuotaSteps(plan: Plan, st: State, p: Period, paid: Map<string, number> | null): Step[] {
  const steps: Step[] = []
  for (const g of debtsOf(plan)) {
    if (!g.payment || !g.payDay) continue
    const date = payDate(p, g.payDay)
    if (!date) continue
    const already = paid?.get(g.kind) ?? 0
    const owed = r2((st.bal.get(g.kind) ?? 0) + already) // el saldo actual ya tiene restado lo abonado
    const amount = r2(Math.min(g.payment, owed))
    if (amount <= 0) continue
    const done = paid ? r2(Math.min(already, amount)) : null
    st.bal.set(g.kind, r2(Math.max(0, (st.bal.get(g.kind) ?? 0) - (amount - (done ?? 0)))))
    if (paid) paid.set(g.kind, r2(already - (done ?? 0)))
    steps.push({ key: 'cuota-' + g.kind, kind: 'cuota', icon: g.icon, label: `Cuota de ${g.label}`, amount, done, date })
  }
  return steps
}

function warn(plan: Plan, q: QuincenaPlan, st: State) {
  if (q.deficit > 0) q.warnings.push(`No alcanza por ${q.deficit.toFixed(2)}: sale del colchón. Para evitarlo, recorta sobres flexibles (salidas, imprevistos).`)
  for (const g of debtsOf(plan)) {
    if (q.start || g.payment || (st.bal.get(g.kind) ?? 0) <= 0) continue
    if (!q.steps.some((s) => s.key === 'extra-' + g.kind && s.amount > 0))
      q.warnings.push(`${g.label} no recibe abono esta quincena: si su estado de cuenta trae un pago mínimo que vence ahora, págalo primero (o agrégalo como cuota en Plan).`)
  }
}

// Quincena actual: mezcla lo ya hecho con lo que falta
function currentQuincena(input: StratInput, today: string, st: State): QuincenaPlan {
  const { plan } = input
  const p = periodFor(today)
  const start = !!plan.startedOn && inPeriod(plan.startedOn, p)
  const frac = start ? (days(plan.startedOn!, p.end) + 1) / (days(p.start, p.end) + 1) : 1

  const inc = input.incomes.filter((i) => inPeriod(i.received_on, p))
  const received = sum(inc.map((i) => i.amount))
  const salary = sum(inc.filter((i) => i.source === plan.incomeSources[0]).map((i) => i.amount))
  const expected = start ? 0 : plan.incomePerQuincena
  const income = r2(received + Math.max(0, expected - salary))

  const exp = input.expenses.filter((e) => inPeriod(e.spent_on, p))
  const spentBy = new Map<string, number>()
  for (const e of exp) spentBy.set(e.category, (spentBy.get(e.category) ?? 0) + e.amount)
  const sobresDone = sum(exp.filter((e) => isSobreExpense(e.category)).map((e) => e.amount))
  // Lo gastado fuera de un sobre (categoria sin presupuesto) tambien cuenta
  const known = new Set(plan.categories.map((c) => c.id))
  const loose = sum(exp.filter((e) => isSobreExpense(e.category) && !known.has(e.category)).map((e) => e.amount))
  const sobres = r2(sum(plan.categories.map((c) => Math.max(r2(c.budget * frac), spentBy.get(c.id) ?? 0))) + loose)

  const steps: Step[] = [{ key: 'sobres', kind: 'sobres', icon: '✉️', label: start ? 'Sobres (proporcional desde que empezaste)' : 'Sobres', amount: sobres, done: sobresDone }]
  let free = r2(income - sobres)

  const paid = new Map(debtsOf(plan).map((g) => [g.kind, paidTo(input, g.kind, p)]))
  // Abonos sin deuda identificada (ej. anotados a mano): cuentan como gasto a deudas
  const debtExp = sum(exp.filter((e) => e.category === DEBT_CATEGORY.id).map((e) => e.amount))
  const unlinked = r2(Math.max(0, debtExp - sum([...paid.values()])))

  const cuotas = cuotaSteps(plan, st, p, paid)
  steps.push(...cuotas)
  free = r2(free - sum(cuotas.map((s) => s.amount)))

  const bills = billSteps(st, p, today, true)
  steps.push(...bills)
  free = r2(free - sum(bills.map((s) => s.amount)))

  // Abonos extra que ya hiciste esta quincena: se respetan
  for (const g of debtsOf(plan)) {
    const extra = paid.get(g.kind) ?? 0
    if (extra <= 0) continue
    steps.push({ key: 'extra-' + g.kind, kind: 'extra', icon: g.icon, label: `Abono extra a ${g.label}`, amount: extra, done: extra })
    free = r2(free - extra)
  }
  if (unlinked > 0) {
    steps.push({ key: 'extra-otro', kind: 'extra', icon: DEBT_CATEGORY.icon, label: 'Abonos a deudas sin deuda indicada', amount: unlinked, done: unlinked })
    free = r2(free - unlinked)
  }

  let deficit = 0
  if (start) {
    // Al empezar, el saldo del colchon era todo el efectivo: al cierre, el colchon es lo que sobre
    for (const g of cushionsOf(plan).slice(0, 1)) {
      const updated = input.balances.find((b) => b.kind === g.kind && inPeriod(b.recorded_on, p) && b.recorded_on > plan.startedOn!)
      const left = updated ? Number(updated.amount) : Math.max(0, free)
      st.bal.set(g.kind, r2(left))
      steps.push({ key: 'colchon-' + g.kind, kind: 'colchon', icon: g.icon, label: `Queda como ${g.label.toLowerCase()} al cierre`, amount: r2(left), done: updated ? r2(left) : null, note: 'Al cerrar la quincena, actualiza su saldo en Metas con lo que de verdad quede.' })
    }
    deficit = free < 0 ? r2(-free) : 0
    free = 0
  } else {
    deficit = coverDeficit(plan, free, st, steps)
    if (free > 0) {
      const res = cascade(plan, free, st, steps)
      for (const s of res.steps) {
        if (s.kind === 'colchon') {
          const g = plan.goals.find((x) => 'colchon-' + x.kind === s.key)
          const updated = g && input.balances.some((b) => b.kind === g.kind && inPeriod(b.recorded_on, p))
          s.done = updated ? s.amount : null
          s.note = 'Lo que sobre al cierre, déjalo ahí y actualiza el saldo en Metas.'
        } else if (s.kind === 'extra') s.done = 0
      }
      steps.push(...res.steps)
      free = res.free
    } else free = 0
  }

  const q: QuincenaPlan = { period: p, current: true, start, expected, received, income, steps, free, deficit, debtAfter: debtTotal(plan, st), warnings: [] }
  if (!start && expected > salary && today >= p.start) q.warnings.push(`Falta que llegue ${(expected - salary).toFixed(2)} de la quincena. Anótala como ingreso cuando caiga.`)
  warn(plan, q, st)
  return q
}

function futureQuincena(plan: Plan, p: Period, st: State): QuincenaPlan {
  // Intereses de la quincena sobre lo que se debe
  for (const g of debtsOf(plan)) {
    const b = st.bal.get(g.kind) ?? 0
    if (b > 0 && g.rate) st.bal.set(g.kind, r2(b * (1 + g.rate / 100 / 24)))
  }
  const income = plan.incomePerQuincena
  const sobres = sum(plan.categories.map((c) => c.budget))
  const steps: Step[] = [{ key: 'sobres', kind: 'sobres', icon: '✉️', label: 'Sobres', amount: sobres, done: null }]
  let free = r2(income - sobres)
  const cuotas = cuotaSteps(plan, st, p, null)
  steps.push(...cuotas)
  free = r2(free - sum(cuotas.map((s) => s.amount)))
  const bills = billSteps(st, p, p.start, false)
  steps.push(...bills)
  free = r2(free - sum(bills.map((s) => s.amount)))
  const deficit = coverDeficit(plan, free, st, steps)
  if (free > 0) {
    const res = cascade(plan, free, st, steps)
    steps.push(...res.steps)
    free = res.free
  } else free = 0
  const q: QuincenaPlan = { period: p, current: false, start: false, expected: income, received: 0, income, steps, free, deficit, debtAfter: debtTotal(plan, st), warnings: [] }
  warn(plan, q, st)
  return q
}

export function buildStrategy(input: StratInput, today: string, horizon = 120): Strategy {
  const { plan } = input
  const st: State = {
    bal: new Map(plan.goals.map((g) => [g.kind, latest(input, g)])),
    bills: plan.bills.map((b) => ({ ...b })),
  }
  const debts = debtsOf(plan)
  const all = [...debts, ...plan.goals.filter((g) => g.type === 'ahorro')]
  const reached = new Map<string, string | null>(all.map((g) => [g.kind, null]))
  const check = (date: string) => {
    for (const g of debts) if (!reached.get(g.kind) && (st.bal.get(g.kind) ?? 0) <= 0.005) reached.set(g.kind, date)
    for (const g of all) if (g.type === 'ahorro' && g.target > 0 && !reached.get(g.kind) && (st.bal.get(g.kind) ?? 0) >= g.target - 0.005) reached.set(g.kind, date)
  }
  if (!plan.incomePerQuincena) return { ready: false, quincenas: [], debts: [], savings: [], debtFree: null }

  for (const g of all) if ((st.bal.get(g.kind) ?? 0) <= 0.005 && g.type === 'deuda') reached.set(g.kind, today)
  const quincenas = [currentQuincena(input, today, st)]
  check(quincenas[0].period.end)
  let p = periodFor(today)
  for (let i = 1; i < horizon; i++) {
    p = shiftPeriod(p, 1)
    const q = futureQuincena(plan, p, st)
    quincenas.push(q)
    // La fecha de cada logro es el dia en que se hace el pago de esa quincena
    check(p.start)
    if ([...reached.values()].every(Boolean) && i >= 6) break
  }

  const ms = (g: Goal): Milestone => ({ kind: g.kind, label: g.label, icon: g.icon, date: reached.get(g.kind) ?? null })
  const debtDates = debts.map(ms)
  const free = debtDates.every((d) => d.date) ? debtDates.map((d) => d.date!).sort().pop() ?? null : null
  return {
    ready: true,
    quincenas,
    debts: debtDates,
    savings: plan.goals.filter((g) => g.type === 'ahorro' && g.target > 0).map(ms),
    debtFree: free,
  }
}
