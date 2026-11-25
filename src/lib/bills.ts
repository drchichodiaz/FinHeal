// Planificacion de pagos programados. Funciones puras: la app y el conector MCP usan las mismas.
import type { Bill, BillRepeat } from './config'
import { fromISO, inPeriod, periodFor, shiftPeriod, toISO, type Period } from './dates'

const DAY = 86400000
const r2 = (n: number) => Math.round(n * 100) / 100

// Dias de margen antes del vencimiento: una quincena que cae a menos de esto no cuenta,
// porque si la empresa paga tarde no llegaria a tiempo.
export const BILL_BUFFER_DAYS = 3
// Si la quincena actual ya va mas avanzada que esto, el dinero ya se repartio: se empieza en la siguiente
const FRESH_PAYDAY_DAYS = 3

export type BillStatus = 'listo' | 'urgente' | 'atrasado' | 'ok'

export type BillPlan = {
  bill: Bill
  remaining: number // lo que falta apartar
  daysLeft: number // dias hasta el vencimiento (negativo = vencido)
  quincenas: Period[] // quincenas de las que sale el dinero, de hoy al vencimiento
  perQuincena: number // cuanto apartar en cada una
  thisQuincena: number // cuanto toca apartar en la quincena actual (0 si empieza en la siguiente)
  status: BillStatus
}

const days = (from: string, to: string) => Math.round((fromISO(to).getTime() - fromISO(from).getTime()) / DAY)

export function planBill(bill: Bill, today: string): BillPlan {
  const remaining = r2(Math.max(0, bill.amount - bill.saved))
  const daysLeft = days(today, bill.due)
  const current = periodFor(today)
  const limit = toISO(new Date(fromISO(bill.due).getTime() - BILL_BUFFER_DAYS * DAY))

  const quincenas: Period[] = []
  const useCurrent = days(current.start, today) <= FRESH_PAYDAY_DAYS && !(bill.savedOn && inPeriod(bill.savedOn, current))
  let p = useCurrent ? current : shiftPeriod(current, 1)
  while (p.start <= limit && quincenas.length < 48) {
    quincenas.push(p)
    p = shiftPeriod(p, 1)
  }

  // Sin quincenas a tiempo: lo que falta hay que apartarlo ya
  const perQuincena = remaining === 0 ? 0 : quincenas.length ? r2(remaining / quincenas.length) : remaining
  const startsNow = !quincenas.length || quincenas[0].start === current.start
  const thisQuincena = remaining > 0 && startsNow ? perQuincena : 0

  let status: BillStatus = 'ok'
  if (remaining === 0) status = 'listo'
  else if (daysLeft < 0) status = 'atrasado'
  else if (daysLeft <= 7 || !quincenas.length) status = 'urgente'

  return { bill, remaining, daysLeft, quincenas, perQuincena, thisQuincena, status }
}

export function planBills(bills: Bill[], today: string): BillPlan[] {
  return bills.map((b) => planBill(b, today)).sort((a, b) => (a.bill.due < b.bill.due ? -1 : 1))
}

// Siguiente vencimiento de un pago que se repite (el 31 de un mes corto cae en su ultimo dia)
export function nextDue(due: string, repeat: BillRepeat): string | null {
  if (repeat === 'none') return null
  const d = fromISO(due)
  const day = d.getDate()
  const target = new Date(d.getFullYear() + (repeat === 'yearly' ? 1 : 0), d.getMonth() + (repeat === 'monthly' ? 1 : 0), 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, last))
  return toISO(target)
}

export const REPEAT_LABEL: Record<BillRepeat, string> = { none: 'Una vez', monthly: 'Cada mes', yearly: 'Cada año' }
