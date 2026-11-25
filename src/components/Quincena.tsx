import { useMemo, useState } from 'react'
import { DEBT_CATEGORY } from '../lib/config'
import { daysLeft, inPeriod, periodFor, shiftPeriod, todayISO } from '../lib/dates'
import { money, round2 } from '../lib/format'
import type { Data } from '../lib/useData'
import { Bar, Card } from './ui'

export function Quincena({ data }: { data: Data }) {
  const { plan } = data
  const target = plan.debtTargetPerQuincena
  const [period, setPeriod] = useState(() => periodFor(todayISO()))
  const isCurrent = period.start === periodFor(todayISO()).start

  const s = useMemo(() => {
    const exp = data.expenses.filter((e) => inPeriod(e.spent_on, period))
    const inc = data.incomes.filter((i) => inPeriod(i.received_on, period))
    const byCat = new Map<string, number>()
    for (const e of exp) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount)
    const income = inc.reduce((t, i) => t + i.amount, 0)
    const spent = exp.filter((e) => e.category !== DEBT_CATEGORY.id).reduce((t, e) => t + e.amount, 0)
    const debt = byCat.get(DEBT_CATEGORY.id) ?? 0
    const budget = plan.categories.reduce((t, c) => t + c.budget, 0)
    return { byCat, income: round2(income), spent: round2(spent), debt: round2(debt), budget: round2(budget), left: round2(income - spent - debt) }
  }, [data, period, plan])

  const over = plan.categories.filter((c) => c.budget > 0 && (s.byCat.get(c.id) ?? 0) > c.budget)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setPeriod(shiftPeriod(period, -1))} className="rounded-full px-3 py-1 text-2xl text-slate-500">‹</button>
        <div className="text-center">
          <div className="font-semibold text-slate-900">{period.label}</div>
          <div className="text-xs text-slate-500">{isCurrent ? `Faltan ${daysLeft(period)} días` : `${period.start} → ${period.end}`}</div>
        </div>
        <button onClick={() => setPeriod(shiftPeriod(period, 1))} className="rounded-full px-3 py-1 text-2xl text-slate-500">›</button>
      </div>

      <Card>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Entró" value={s.income} />
          <Stat label="Gastado" value={s.spent} />
          <Stat label="A deudas" value={s.debt} />
        </div>
        <div className="mt-3 rounded-xl bg-slate-50 py-2 text-center">
          <div className="text-xs text-slate-500">Queda en cuenta</div>
          <div className={`text-2xl font-bold ${s.left < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{money(s.left)}</div>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold text-slate-900">💳 Abono a deudas</h2>
          <span className="text-sm text-slate-500">
            {money(s.debt)} / {money(target)}
          </span>
        </div>
        <Bar value={s.debt} max={target} invert />
        <p className="mt-2 text-xs text-slate-500">Meta de abono por quincena (se cambia en Plan).</p>
      </Card>

      <Card>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semibold text-slate-900">Sobres</h2>
          <span className="text-sm text-slate-500">
            {money(s.spent)} / {money(s.budget)}
          </span>
        </div>
        <ul className="space-y-3">
          {plan.categories.filter((c) => c.budget > 0).map((c) => {
            const v = round2(s.byCat.get(c.id) ?? 0)
            return (
              <li key={c.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>
                    {c.icon} {c.label}
                  </span>
                  <span className={v > c.budget ? 'font-semibold text-rose-600' : 'text-slate-600'}>
                    {money(v)} <span className="text-slate-400">/ {money(c.budget)}</span>
                  </span>
                </div>
                <Bar value={v} max={c.budget} />
              </li>
            )
          })}
        </ul>
        {over.length > 0 && (
          <p className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">
            Te pasaste en: {over.map((c) => c.label).join(', ')}. Recorta en otro sobre para compensar.
          </p>
        )}
      </Card>

      {plan.rules.length > 0 && (
      <Card className="bg-emerald-50 ring-emerald-200">
        <h2 className="mb-2 font-semibold text-emerald-900">Reglas</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-emerald-900">
          {plan.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{money(value)}</div>
    </div>
  )
}
