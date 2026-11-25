import { useState } from 'react'
import type { QuincenaPlan, Step, Strategy } from '../lib/strategy'
import { fromISO, prettyDate } from '../lib/dates'
import { money } from '../lib/format'
import { Card } from './ui'

const C = { accent: '#2a78d6', track: '#cde2fb', good: '#0ca30c', goodText: '#006300', warning: '#fab219', critical: '#d03b3b' }
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const monthYear = (iso: string) => `${MONTHS[fromISO(iso).getMonth()]} ${fromISO(iso).getFullYear()}`
const PREVIEW = 6 // quincenas que se pueden ver hacia adelante

export function Estrategia({ strategy, onSetup }: { strategy: Strategy; onSetup: () => void }) {
  const [i, setI] = useState(0)
  if (!strategy.ready)
    return (
      <Card>
        <h2 className="font-semibold text-slate-900">🧭 Qué hacer ahora</h2>
        <p className="mt-1 text-sm text-slate-500">Para calcular tu estrategia, pon en Plan cuánto te entra por quincena y la tasa y cuota de cada deuda.</p>
        <button onClick={onSetup} className="mt-2 text-sm font-medium text-emerald-700">
          Ir al plan →
        </button>
      </Card>
    )

  const max = Math.min(PREVIEW, strategy.quincenas.length) - 1
  const q = strategy.quincenas[Math.min(i, max)]
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">🧭 {q.current ? 'Qué hacer ahora' : 'Lo que viene'}</h2>
        <div className="flex items-center text-sm text-slate-500">
          <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="px-2 text-xl disabled:opacity-30" aria-label="Quincena anterior">
            ‹
          </button>
          <span className="min-w-24 text-center text-xs">{q.current ? 'Esta quincena' : `del ${fromISO(q.period.start).getDate()} ${MONTHS[fromISO(q.period.start).getMonth()]}`}</span>
          <button onClick={() => setI(Math.min(max, i + 1))} disabled={i >= max} className="px-2 text-xl disabled:opacity-30" aria-label="Quincena siguiente">
            ›
          </button>
        </div>
      </div>
      <Income q={q} />
      <ol className="mt-3 space-y-2.5">
        {q.steps.map((s) => (
          <StepRow key={s.key} s={s} current={q.current} />
        ))}
      </ol>
      {q.free > 0 && <p className="mt-2 text-sm text-slate-600">Sin asignar: {money(q.free)}</p>}
      {q.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {q.warnings.map((w) => (
            <li key={w} className="flex gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              <span aria-hidden>●</span>
              <span>{w.replace(/(\d+\.\d{2})/g, (m) => money(Number(m)))}</span>
            </li>
          ))}
        </ul>
      )}
      <Milestones strategy={strategy} />
    </Card>
  )
}

function Income({ q }: { q: QuincenaPlan }) {
  if (!q.current) return <p className="mt-1 text-sm text-slate-500">Si entra {money(q.income)}, así se reparte:</p>
  const pending = q.income - q.received
  return (
    <p className="mt-1 text-sm text-slate-500">
      {q.start ? `Empezaste con ${money(q.received)}.` : pending > 0.005 ? `Entró ${money(q.received)} · falta ${money(pending)} de la quincena.` : `Entró ${money(q.received)}.`}
    </p>
  )
}

function StepRow({ s, current }: { s: Step; current: boolean }) {
  const done = s.done ?? 0
  const complete = current && s.done !== null && s.amount > 0 && done >= s.amount - 0.005
  const partial = current && s.done !== null && done > 0 && !complete
  const negative = s.amount < 0
  const showMeter = current && s.kind === 'sobres'
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={`min-w-0 ${complete && !showMeter ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
          <span aria-hidden>{s.icon}</span> {s.label}
          {s.date && s.kind === 'cuota' && <span className="text-xs text-slate-500"> · {prettyDate(s.date)}</span>}
          {s.date && s.kind === 'pago' && <span className="text-xs text-slate-500"> · vence {prettyDate(s.date)}</span>}
        </span>
        <span className={`shrink-0 font-semibold tabular-nums ${negative ? '' : 'text-slate-900'}`} style={negative ? { color: C.critical } : undefined}>
          {negative ? '−' : ''}
          {money(Math.abs(s.amount))}
        </span>
      </div>
      {showMeter ? (
        <SobresMeter spent={done} budget={s.amount} />
      ) : current && s.done !== null ? (
        <div className="text-xs" style={{ color: complete ? C.goodText : undefined }}>
          {complete ? '✓ Hecho' : partial ? <span className="text-slate-500">Llevas {money(done)} · faltan {money(s.amount - done)}</span> : <span className="text-slate-500">○ Pendiente</span>}
        </div>
      ) : null}
      {s.note && current && <div className="text-xs text-slate-400">{s.note}</div>}
    </li>
  )
}

function SobresMeter({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? spent / budget : 0
  const fill = pct > 1 ? C.critical : pct >= 0.8 ? C.warning : C.accent
  return (
    <div className="mt-1">
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: C.track }} role="meter" aria-valuenow={spent} aria-valuemax={budget} aria-label="Gastado en sobres">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: fill }} />
      </div>
      <div className="text-xs text-slate-500">
        Gastado {money(spent)} · te quedan {money(Math.max(0, budget - spent))} en sobres
      </div>
    </div>
  )
}

function Milestones({ strategy }: { strategy: Strategy }) {
  const items = [...strategy.debts, ...strategy.savings]
  if (!items.length) return null
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="mb-1.5 text-xs font-medium text-slate-500">Si sigues la estrategia</div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        {items.map((m) => (
          <li key={m.kind} className="min-w-0">
            <div className="truncate text-xs text-slate-500">
              {m.icon} {m.label}
            </div>
            <div className="font-semibold text-slate-900">{m.date ? monthYear(m.date) : 'más de 5 años'}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">Se recalcula con cada gasto, abono o saldo que anotas. Sin contar décimos: si llegan, adelantan las fechas.</p>
    </div>
  )
}
