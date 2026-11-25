import { useState } from 'react'
import type { Goal } from '../lib/config'
import { prettyDate, todayISO } from '../lib/dates'
import { money, round2 } from '../lib/format'
import { supabase } from '../lib/supabase'
import { latestBalance, type Data } from '../lib/useData'
import { Bar, Card } from './ui'

export function Metas({ data, onSaved }: { data: Data; onSaved: (msg: string) => void }) {
  const debts = data.plan.goals.filter((g) => g.type === 'deuda')
  const totalDebt = round2(debts.reduce((t, g) => t + latestBalance(data.balances, g.kind, g.initial), 0))
  const initialDebt = round2(debts.reduce((t, g) => t + g.initial, 0))

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 text-white ring-slate-900">
        <div className="text-sm text-slate-300">Deuda total</div>
        <div className="text-3xl font-bold">{money(totalDebt)}</div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-emerald-400"
            style={{ width: `${initialDebt ? Math.min(100, ((initialDebt - totalDebt) / initialDebt) * 100) : 0}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-slate-300">
          Pagado {money(Math.max(0, initialDebt - totalDebt))} de {money(initialDebt)}
        </div>
      </Card>

      {data.plan.goals.map((g) => (
        <GoalCard key={g.kind} goal={g} data={data} onSaved={onSaved} />
      ))}
    </div>
  )
}

function GoalCard({ goal, data, onSaved }: { goal: Goal; data: Data; onSaved: (msg: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const current = latestBalance(data.balances, goal.kind, goal.initial)
  const history = data.balances.filter((b) => b.kind === goal.kind).slice(0, 4)

  const owed = goal.type !== 'ahorro'
  const progress = owed ? goal.initial - current : current
  const max = owed ? goal.initial : goal.target
  const done = owed ? current <= 0 : current >= goal.target

  async function save() {
    const n = Number(value.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return
    setBusy(true)
    const { error } = await supabase.from('balances').insert({ kind: goal.kind, amount: round2(n), recorded_on: todayISO() })
    setBusy(false)
    if (!error) {
      setEditing(false)
      setValue('')
      onSaved(`${goal.label}: ${money(n)}`)
    } else onSaved(`Error: ${error.message}`)
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">
            {goal.icon} {goal.label} {done && '✅'}
          </h2>
          <p className="text-xs text-slate-500">{goal.hint}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-slate-900">{money(current)}</div>
          {goal.type === 'ahorro' && <div className="text-xs text-slate-500">de {money(goal.target)}</div>}
        </div>
      </div>
      <div className="mt-3">
        <Bar value={Math.max(0, progress)} max={max} invert />
      </div>

      {editing ? (
        <div className="mt-3 flex gap-2">
          <input
            autoFocus
            inputMode="decimal"
            placeholder="Saldo actual"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
          />
          <button onClick={save} disabled={busy} className="rounded-xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-50">
            Guardar
          </button>
          <button onClick={() => setEditing(false)} className="rounded-xl px-3 text-slate-500">
            ✕
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-3 text-sm font-medium text-emerald-700">
          Actualizar saldo
        </button>
      )}

      {history.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
          {history.map((h) => (
            <li key={h.id} className="flex justify-between">
              <span>{prettyDate(h.recorded_on)}</span>
              <span>{money(h.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
