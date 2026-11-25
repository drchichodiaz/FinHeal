import { useMemo } from 'react'
import { allCategories } from '../lib/config'
import { prettyDate, todayISO } from '../lib/dates'
import { csv, download, money } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Data } from '../lib/useData'
import { Card } from './ui'

type Row = { id: string; date: string; amount: number; title: string; sub: string; kind: 'gasto' | 'ingreso' }

export function Historial({ data, onChanged }: { data: Data; onChanged: (msg: string) => void }) {
  const groups = useMemo(() => {
    const rows: Row[] = [
      ...data.expenses.map((e) => {
        const c = allCategories(data.plan).find((x) => x.id === e.category)
        return {
          id: e.id,
          date: e.spent_on,
          amount: e.amount,
          title: `${c?.icon ?? '•'} ${c?.label ?? e.category}`,
          sub: [e.method, e.note].filter(Boolean).join(' · '),
          kind: 'gasto' as const,
        }
      }),
      ...data.incomes.map((i) => ({
        id: i.id,
        date: i.received_on,
        amount: i.amount,
        title: `💵 ${i.source}`,
        sub: i.note ?? '',
        kind: 'ingreso' as const,
      })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    const map = new Map<string, Row[]>()
    for (const r of rows) map.set(r.date, [...(map.get(r.date) ?? []), r])
    return [...map.entries()].slice(0, 60)
  }, [data])

  async function remove(r: Row) {
    if (!confirm(`¿Borrar ${r.title} de ${money(r.amount)}?`)) return
    const { error } = await supabase.from(r.kind === 'gasto' ? 'expenses' : 'incomes').delete().eq('id', r.id)
    onChanged(error ? `Error: ${error.message}` : 'Borrado')
  }

  function exportAll() {
    const t = todayISO()
    download(`gastos-${t}.csv`, csv(data.expenses))
    download(`ingresos-${t}.csv`, csv(data.incomes))
    download(`saldos-${t}.csv`, csv(data.balances))
  }

  return (
    <div className="space-y-4">
      <button onClick={exportAll} className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
        ⬇️ Exportar todo (CSV)
      </button>
      {groups.length === 0 && <p className="text-center text-sm text-slate-500">Todavía no hay registros.</p>}
      {groups.map(([date, rows]) => (
        <Card key={date} className="p-0">
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase text-slate-500">{prettyDate(date)}</div>
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-b border-slate-50 px-4 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{r.title}</div>
                  {r.sub && <div className="truncate text-xs text-slate-500">{r.sub}</div>}
                </div>
                <div className={`text-sm font-semibold ${r.kind === 'ingreso' ? 'text-emerald-600' : 'text-slate-900'}`}>
                  {r.kind === 'ingreso' ? '+' : '−'}
                  {money(r.amount)}
                </div>
                <button onClick={() => remove(r)} aria-label="Borrar" className="px-1 text-slate-300 hover:text-rose-500">
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
