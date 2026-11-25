// Fechas como 'YYYY-MM-DD' en hora local, para evitar desfaces de zona horaria.

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayISO(): string {
  return toISO(new Date())
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

// Dia de cobro de fin de mes: el 30, o el ultimo dia si el mes es mas corto (febrero)
function endPayday(y: number, m: number): number {
  return Math.min(30, daysInMonth(y, m))
}

export type Period = { start: string; end: string; label: string }

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Las quincenas van de dia de cobro a dia de cobro: del 15 al 29, y del 30 al 14 del mes siguiente.
export function periodFor(iso: string): Period {
  const d = fromISO(iso)
  const y = d.getFullYear()
  const m = d.getMonth()
  const day = d.getDate()
  const p30 = endPayday(y, m)

  let start: Date
  let end: Date
  if (day >= 15 && day < p30) {
    start = new Date(y, m, 15)
    end = new Date(y, m, p30 - 1)
  } else if (day >= p30) {
    start = new Date(y, m, p30)
    end = new Date(y, m + 1, 14)
  } else {
    const prev = new Date(y, m - 1, 1)
    start = new Date(prev.getFullYear(), prev.getMonth(), endPayday(prev.getFullYear(), prev.getMonth()))
    end = new Date(y, m, 14)
  }
  return {
    start: toISO(start),
    end: toISO(end),
    label: `Quincena del ${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`,
  }
}

export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  const ref = fromISO(dir === 1 ? p.end : p.start)
  ref.setDate(ref.getDate() + dir)
  return periodFor(toISO(ref))
}

export function inPeriod(iso: string, p: Period): boolean {
  return iso >= p.start && iso <= p.end
}

export function prettyDate(iso: string): string {
  const d = fromISO(iso)
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
  return `${dias[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function daysLeft(p: Period): number {
  const end = fromISO(p.end).getTime()
  const now = fromISO(todayISO()).getTime()
  return Math.max(0, Math.round((end - now) / 86400000) + 1)
}
