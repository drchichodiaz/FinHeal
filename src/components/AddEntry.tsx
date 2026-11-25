import { useMemo, useState, type FormEvent } from 'react'
import { DEBT_CATEGORY, allCategories } from '../lib/config'
import { inPeriod, periodFor, todayISO } from '../lib/dates'
import { money, round2 } from '../lib/format'
import { supabase } from '../lib/supabase'
import { latestBalance, type Data } from '../lib/useData'

type Mode = 'gasto' | 'ingreso'

export function AddEntry({ data, onSaved }: { data: Data; onSaved: (msg: string) => void }) {
  const { plan } = data
  const categories = allCategories(plan)
  const [mode, setMode] = useState<Mode>('gasto')
  const [amount, setAmount] = useState('')
  const [categoryRaw, setCategory] = useState(categories[0].id)
  const [methodRaw, setMethod] = useState<string>(plan.methods[0])
  const [sourceRaw, setSource] = useState<string>(plan.incomeSources[0])
  const debts = plan.goals.filter((g) => g.type === 'deuda')
  const [goalRaw, setGoal] = useState<string>('')
  const goal = debts.find((g) => g.kind === goalRaw) ?? debts[0]
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El plan puede cargar despues del primer render: si la seleccion ya no existe, usar la primera opcion
  const cat = categories.find((c) => c.id === categoryRaw) ?? categories[0]
  const category = cat.id
  const method = plan.methods.includes(methodRaw) ? methodRaw : plan.methods[0]
  const source = plan.incomeSources.includes(sourceRaw) ? sourceRaw : plan.incomeSources[0]
  const period = periodFor(date)

  const remaining = useMemo(() => {
    if (!cat.budget) return null
    const spent = data.expenses
      .filter((e) => e.category === cat.id && inPeriod(e.spent_on, period))
      .reduce((s, e) => s + e.amount, 0)
    return round2(cat.budget - spent)
  }, [data.expenses, cat, period])

  const value = Number(amount.replace(',', '.'))
  const valid = Number.isFinite(value) && value > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    const amt = round2(value)
    const noteVal = note.trim() || null

    if (mode === 'gasto') {
      const isDebt = category === DEBT_CATEGORY.id && !!goal
      const finalNote = isDebt && !noteVal ? `Abono a ${goal.label}` : noteVal
      const { error } = await supabase.from('expenses').insert({ amount: amt, category, method, spent_on: date, note: finalNote })
      if (!error && isDebt) {
        // Baja el saldo de esa deuda al instante; el saldo real (con intereses) se corrige despues del corte
        const current = latestBalance(data.balances, goal.kind, goal.initial)
        await supabase.from('balances').insert({ kind: goal.kind, amount: Math.max(0, round2(current - amt)), recorded_on: date, note: `Automático: abono de ${money(amt)}` })
      }
      if (error) {
        setError(error.message)
      } else {
        const left = remaining === null ? null : round2(remaining - amt)
        onSaved(
          isDebt
            ? `Abono guardado. ${goal.label}: ${money(Math.max(0, round2(latestBalance(data.balances, goal.kind, goal.initial) - amt)))} 💪`
            : left === null
            ? `Guardado: ${money(amt)} en ${cat.label}`
            : left >= 0
              ? `Guardado. Te quedan ${money(left)} en ${cat.label}`
              : `Guardado. ⚠️ Te pasaste ${money(-left)} en ${cat.label}`,
        )
        setAmount('')
        setNote('')
      }
    } else {
      const { error } = await supabase.from('incomes').insert({ amount: amt, source, received_on: date, note: noteVal })
      const linked = plan.goals.filter((g) => g.reducedBySource === source)
      if (!error) {
        for (const goal of linked) {
          const current = latestBalance(data.balances, goal.kind, goal.initial)
          await supabase.from('balances').insert({
            kind: goal.kind,
            amount: Math.max(0, round2(current - amt)),
            recorded_on: date,
            note: `Automático: ingreso "${source}"`,
          })
        }
      }
      if (error) setError(error.message)
      else {
        onSaved(`Ingreso guardado: ${money(amt)}`)
        setAmount('')
        setNote('')
      }
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-2 rounded-xl bg-slate-200 p-1 text-sm font-semibold">
        {(['gasto', 'ingreso'] as Mode[]).map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 ${mode === m ? 'bg-white text-slate-900 shadow' : 'text-slate-600'}`}
          >
            {m === 'gasto' ? 'Gasto' : 'Ingreso'}
          </button>
        ))}
      </div>

      <div className="text-center">
        <div className="flex items-center justify-center text-5xl font-bold text-slate-900">
          <span className="text-slate-400">$</span>
          <input
            autoFocus
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
            className="w-48 bg-transparent text-center outline-none placeholder:text-slate-300"
          />
        </div>
        {mode === 'gasto' && remaining !== null && (
          <p className={`mt-1 text-sm ${remaining < 0 ? 'text-rose-600' : remaining < cat.budget * 0.2 ? 'text-amber-600' : 'text-slate-500'}`}>
            {remaining >= 0 ? `Quedan ${money(remaining)} de ${money(cat.budget)} en este sobre` : `Este sobre ya está pasado por ${money(-remaining)}`}
          </p>
        )}
      </div>

      {mode === 'gasto' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {categories.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`rounded-xl px-2 py-3 text-xs font-medium ring-1 ${
                  category === c.id ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-700 ring-slate-200'
                }`}
              >
                <div className="text-xl">{c.icon}</div>
                {c.label}
              </button>
            ))}
          </div>
          {category === DEBT_CATEGORY.id && debts.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">¿A qué deuda?</div>
              <Chips options={debts.map((g) => g.label)} value={goal.label} onChange={(l) => setGoal(debts.find((g) => g.label === l)?.kind ?? '')} />
            </div>
          )}
          <Chips options={plan.methods} value={method} onChange={setMethod} />
        </>
      ) : (
        <Chips options={plan.incomeSources} value={source} onChange={setSource} />
      )}

      <div className="grid grid-cols-[auto_1fr] gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || todayISO())}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
        />
        <input
          placeholder="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500"
        />
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        disabled={!valid || busy}
        className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-semibold text-white active:bg-emerald-700 disabled:opacity-40"
      >
        {busy ? 'Guardando…' : mode === 'gasto' ? 'Anotar gasto' : 'Anotar ingreso'}
      </button>
    </form>
  )
}

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-full px-4 py-2 text-sm font-medium ring-1 ${
            value === o ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}
