import { BILL_CATEGORY, DEBT_CATEGORY, isSobreExpense, type Goal } from './config'
import { fromISO, inPeriod, periodFor, shiftPeriod, todayISO, type Period } from './dates'
import type { Data } from './useData'

const DAY = 86400000
const QUINCENA_DAYS = 365.25 / 24 // ~15.2 dias
const r2 = (n: number) => Math.round(n * 100) / 100

export type DebtPoint = { date: string; total: number }

// Saldo de una meta a una fecha: el ultimo registro con recorded_on <= fecha, o el inicial
function balanceAt(data: Data, goal: Goal, date: string): number {
  const row = data.balances.find((b) => b.kind === goal.kind && b.recorded_on <= date)
  return row ? row.amount : goal.initial
}

export function debtGoals(data: Data): Goal[] {
  return data.plan.goals.filter((g) => g.type === 'deuda')
}

// Serie de deuda total: un punto por cada fecha en que cambio algun saldo, mas hoy
export function debtSeries(data: Data): DebtPoint[] {
  const goals = debtGoals(data)
  const kinds = new Set(goals.map((g) => g.kind))
  const dates = [...new Set(data.balances.filter((b) => kinds.has(b.kind)).map((b) => b.recorded_on))]
  const today = todayISO()
  if (!dates.includes(today)) dates.push(today)
  dates.sort()
  return dates.map((d) => ({ date: d, total: r2(goals.reduce((t, g) => t + balanceAt(data, g, d), 0)) }))
}

export type PlanLine = { start: number; startTotal: number; payoff: number | null; perDay: number }

// Ritmo meta: baja `debtTargetPerQuincena` cada quincena desde el primer punto (sin intereses)
export function planLine(data: Data, series: DebtPoint[]): PlanLine | null {
  const target = data.plan.debtTargetPerQuincena
  if (!series.length || target <= 0) return null
  const start = fromISO(series[0].date).getTime()
  const startTotal = series[0].total
  const perDay = target / QUINCENA_DAYS
  return { start, startTotal, perDay, payoff: startTotal > 0 ? start + (startTotal / perDay) * DAY : null }
}

export function planAt(p: PlanLine, t: number): number {
  return Math.max(0, r2(p.startTotal - p.perDay * ((t - p.start) / DAY)))
}

export type QuincenaStat = {
  period: Period
  income: number
  spent: number
  debt: number
  bills: number // pagos programados (cubiertos con lo apartado)
  budget: number
  left: number
  current: boolean
}

export function quincenaStat(data: Data, period: Period): QuincenaStat {
  const exp = data.expenses.filter((e) => inPeriod(e.spent_on, period))
  const income = r2(data.incomes.filter((i) => inPeriod(i.received_on, period)).reduce((t, i) => t + i.amount, 0))
  const sum = (f: (c: string) => boolean) => r2(exp.filter((e) => f(e.category)).reduce((t, e) => t + e.amount, 0))
  const spent = sum(isSobreExpense)
  const debt = sum((c) => c === DEBT_CATEGORY.id)
  const bills = sum((c) => c === BILL_CATEGORY.id)
  const budget = r2(data.plan.categories.reduce((t, c) => t + c.budget, 0))
  return { period, income, spent, debt, bills, budget, left: r2(income - spent - debt - bills), current: inPeriod(todayISO(), period) }
}

// Ultimas quincenas (hasta 6) desde la primera con movimientos
export function recentQuincenas(data: Data, max = 6): QuincenaStat[] {
  const firstDates = [...data.expenses.map((e) => e.spent_on), ...data.incomes.map((i) => i.received_on)].sort()
  const first = firstDates[0]
  let p = periodFor(todayISO())
  const out: QuincenaStat[] = []
  for (let i = 0; i < max; i++) {
    if (first && p.end < first) break
    out.unshift(quincenaStat(data, p))
    p = shiftPeriod(p, -1)
    if (!first) break
  }
  return out
}

export function totalDebtPaid(data: Data, since: string): number {
  return r2(data.expenses.filter((e) => e.category === DEBT_CATEGORY.id && e.spent_on >= since).reduce((t, e) => t + e.amount, 0))
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const monthYear = (t: number) => {
  const d = new Date(t)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
export const dayMonth = (t: number) => {
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}
