import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</section>
}

export function Bar({ value, max, invert = false }: { value: number; max: number; invert?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  // invert: mas es mejor (abonos, ahorro). normal: mas es peor (gasto contra sobre)
  let color = 'bg-emerald-500'
  if (!invert) {
    if (value > max) color = 'bg-rose-500'
    else if (pct >= 80) color = 'bg-amber-400'
  } else if (pct < 50) color = 'bg-sky-500'
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">{text}</div>
    </div>
  )
}
