import { useState } from 'react'
import { BILL_CATEGORY, newId, type Bill, type BillRepeat } from '../lib/config'
import { REPEAT_LABEL, nextDue, planBills, type BillPlan } from '../lib/bills'
import { fromISO, inPeriod, periodFor, prettyDate, todayISO } from '../lib/dates'
import { money, round2 } from '../lib/format'
import { supabase } from '../lib/supabase'
import { savePlan, type Data } from '../lib/useData'
import { Card } from './ui'

const C = { accent: '#2a78d6', track: '#cde2fb', good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' }
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const short = (iso: string) => `${fromISO(iso).getDate()} ${MONTHS[fromISO(iso).getMonth()]}`

function list(items: string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

function StatusLine({ p }: { p: BillPlan }) {
  const when = p.daysLeft === 0 ? 'vence hoy' : p.daysLeft > 0 ? `en ${p.daysLeft} días` : `venció hace ${-p.daysLeft} días`
  const badge =
    p.status === 'listo' ? <span style={{ color: '#006300' }}>✓ Listo · </span>
    : p.status === 'atrasado' ? <span style={{ color: C.critical }}>⚠ Vencido · </span>
    : p.status === 'urgente' ? <span className="text-amber-700">● Urgente · </span>
    : null
  return (
    <div className="text-xs text-slate-500">
      {badge}
      {prettyDate(p.bill.due)} · {when}
      {p.bill.repeat !== 'none' && ` · ${REPEAT_LABEL[p.bill.repeat].toLowerCase()}`}
    </div>
  )
}

function Advice({ p }: { p: BillPlan }) {
  if (p.status === 'listo') return <p className="mt-1 text-xs text-slate-500">Ya tienes todo apartado. No lo toques hasta pagarlo.</p>
  if (!p.quincenas.length) return <p className="mt-1 text-xs font-medium text-slate-700">Aparta {money(p.remaining)} ya: no queda otra quincena antes de que venza.</p>
  return (
    <p className="mt-1 text-xs text-slate-600">
      Aparta <span className="font-semibold text-slate-900">{money(p.perQuincena)}</span>
      {p.quincenas.length === 1 ? ' de la quincena del ' : ' de cada quincena: '}
      {list(p.quincenas.map((q) => short(q.start)))}.
    </p>
  )
}

function Meter({ p }: { p: BillPlan }) {
  const pct = p.bill.amount > 0 ? Math.min(1, p.bill.saved / p.bill.amount) : 0
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: C.track }} role="meter" aria-valuenow={Math.round(pct * 100)} aria-valuemax={100} aria-label={`${p.bill.label}: apartado`}>
      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: pct >= 1 ? C.good : C.accent }} />
    </div>
  )
}

// Resumen para Inicio
export function PagosResumen({ data, onOpen }: { data: Data; onOpen: () => void }) {
  const plans = planBills(data.plan.bills, todayISO())
  const now = round2(plans.reduce((t, p) => t + p.thisQuincena, 0))
  return (
    <Card>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-semibold text-slate-900">📅 Próximos pagos</h2>
        <button onClick={onOpen} className="text-sm font-medium text-emerald-700">
          {plans.length ? 'Planificar →' : 'Agregar →'}
        </button>
      </div>
      {!plans.length ? (
        <p className="text-sm text-slate-500">Agenda seguros, matrículas o impuestos para ir apartando por quincena y que no te agarren de sorpresa.</p>
      ) : (
        <>
          {now > 0 && (
            <p className="mb-2 text-sm text-slate-700">
              Esta quincena aparta <span className="font-semibold">{money(now)}</span>.
            </p>
          )}
          <ul className="space-y-3">
            {plans.slice(0, 4).map((p) => (
              <li key={p.bill.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-slate-800">
                    {p.bill.icon} {p.bill.label}
                  </span>
                  <span className="shrink-0 text-slate-600">
                    {money(p.bill.saved)} <span className="text-slate-400">de {money(p.bill.amount)}</span>
                  </span>
                </div>
                <Meter p={p} />
                <div className="mt-1">
                  <StatusLine p={p} />
                  <Advice p={p} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

// Gestion completa (en Metas)
export function Pagos({ data, onSaved }: { data: Data; onSaved: (msg: string) => void }) {
  const plans = planBills(data.plan.bills, todayISO())
  const [adding, setAdding] = useState(false)

  async function saveBills(bills: Bill[], msg: string) {
    const { error } = await savePlan({ ...data.plan, bills })
    onSaved(error ? `Error: ${error.message}` : msg)
    return !error
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-semibold text-slate-900">📅 Pagos programados</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-sm font-medium text-emerald-700">
            + Agregar
          </button>
        )}
      </div>
      {adding && (
        <BillForm
          methods={data.plan.methods}
          onCancel={() => setAdding(false)}
          onSave={async (b) => {
            if (await saveBills([...data.plan.bills, { ...b, id: newId('pago'), saved: 0 }], `Agendado: ${b.label}`)) setAdding(false)
          }}
        />
      )}
      {!plans.length && !adding && (
        <Card>
          <p className="text-sm text-slate-500">Nada agendado. Agrega pagos que sabes que vienen (seguro del carro, matrícula, impuestos) y FinHeal te dice cuánto apartar cada quincena.</p>
        </Card>
      )}
      {plans.map((p) => (
        <BillCard key={p.bill.id} p={p} data={data} saveBills={saveBills} onSaved={onSaved} />
      ))}
      {plans.length > 0 && <p className="px-1 text-xs text-slate-500">Lo apartado sigue en tu cuenta, pero ya no es dinero libre: no lo gastes.</p>}
    </div>
  )
}

type Mode = null | 'apartar' | 'pagar' | 'editar'

function BillCard({ p, data, saveBills, onSaved }: { p: BillPlan; data: Data; saveBills: (b: Bill[], msg: string) => Promise<boolean>; onSaved: (msg: string) => void }) {
  const [mode, setMode] = useState<Mode>(null)
  const [value, setValue] = useState('')
  const [method, setMethod] = useState(data.plan.methods[0])
  const [busy, setBusy] = useState(false)
  const b = p.bill
  const others = data.plan.bills.filter((x) => x.id !== b.id)
  const replace = (nb: Bill) => data.plan.bills.map((x) => (x.id === b.id ? nb : x))
  const n = Number(value.replace(',', '.'))
  const valid = Number.isFinite(n) && n > 0

  function open(m: Mode) {
    setMode(m)
    setValue(m === 'apartar' ? String(p.perQuincena || p.remaining || '') : m === 'pagar' ? String(b.amount) : '')
  }

  async function apartar(sign: 1 | -1) {
    if (!valid) return
    setBusy(true)
    const saved = round2(Math.max(0, b.saved + sign * n))
    const prev = b.savedOn && inPeriod(b.savedOn, periodFor(todayISO())) ? (b.lastSaved ?? 0) : 0
    const lastSaved = round2(Math.max(0, prev + sign * n))
    if (await saveBills(replace({ ...b, saved, savedOn: todayISO(), lastSaved }), sign > 0 ? `Apartado ${money(n)} para ${b.label}` : `Devuelto ${money(n)}`)) setMode(null)
    setBusy(false)
  }

  async function pagar() {
    if (!valid) return
    setBusy(true)
    const amt = round2(n)
    const { error } = await supabase.from('expenses').insert({ amount: amt, category: BILL_CATEGORY.id, method, spent_on: todayISO(), note: b.label })
    if (error) {
      onSaved(`Error: ${error.message}`)
      setBusy(false)
      return
    }
    const next = nextDue(b.due, b.repeat)
    const bills = next ? replace({ ...b, due: next, saved: 0, savedOn: undefined, lastSaved: undefined }) : others
    await saveBills(bills, next ? `Pagado ${money(amt)}. Próximo: ${prettyDate(next)}` : `Pagado ${money(amt)}: ${b.label}`)
    setMode(null)
    setBusy(false)
  }

  async function borrar() {
    if (!window.confirm(`¿Quitar "${b.label}" de pagos programados? No se registra ningún gasto.`)) return
    await saveBills(others, `Quitado: ${b.label}`)
  }

  if (mode === 'editar')
    return (
      <BillForm
        initial={b}
        methods={data.plan.methods}
        onCancel={() => setMode(null)}
        onDelete={borrar}
        onSave={async (nb) => {
          if (await saveBills(replace({ ...b, ...nb }), `Actualizado: ${nb.label}`)) setMode(null)
        }}
      />
    )

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900">
            {b.icon} {b.label}
          </h3>
          <StatusLine p={p} />
        </div>
        <button onClick={() => open('editar')} className="shrink-0 text-xs text-slate-500 underline">
          Editar
        </button>
      </div>
      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span className="text-slate-600">
          Apartado <span className="font-semibold text-slate-900">{money(b.saved)}</span> de {money(b.amount)}
        </span>
        {p.remaining > 0 && <span className="text-slate-500">faltan {money(p.remaining)}</span>}
      </div>
      <Meter p={p} />
      <Advice p={p} />
      {b.note && <p className="mt-1 text-xs text-slate-400">{b.note}</p>}

      {mode === 'apartar' || mode === 'pagar' ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
              aria-label={mode === 'apartar' ? 'Monto a apartar' : 'Monto pagado'}
            />
            {mode === 'pagar' && (
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-xl border border-slate-300 px-2" aria-label="Método">
                {data.plan.methods.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            {mode === 'apartar' ? (
              <>
                <button onClick={() => apartar(1)} disabled={busy || !valid} className="flex-1 rounded-xl bg-emerald-600 py-2 font-semibold text-white disabled:opacity-50">
                  Apartar
                </button>
                {b.saved > 0 && (
                  <button onClick={() => apartar(-1)} disabled={busy || !valid} className="rounded-xl px-3 text-sm text-slate-600 ring-1 ring-slate-300 disabled:opacity-50">
                    Devolver
                  </button>
                )}
              </>
            ) : (
              <button onClick={pagar} disabled={busy || !valid} className="flex-1 rounded-xl bg-emerald-600 py-2 font-semibold text-white disabled:opacity-50">
                Registrar pago
              </button>
            )}
            <button onClick={() => setMode(null)} className="rounded-xl px-3 text-slate-500">
              ✕
            </button>
          </div>
          {mode === 'pagar' && <p className="text-xs text-slate-500">Se anota como gasto de hoy (📅 Pago programado, fuera de los sobres){b.repeat !== 'none' ? ' y se agenda el siguiente.' : ' y se quita de la lista.'}</p>}
        </div>
      ) : (
        <div className="mt-3 flex gap-4 text-sm font-medium">
          {p.remaining > 0 && (
            <button onClick={() => open('apartar')} className="text-emerald-700">
              Apartar
            </button>
          )}
          <button onClick={() => open('pagar')} className="text-emerald-700">
            Ya lo pagué
          </button>
        </div>
      )}
    </Card>
  )
}

type BillDraft = Pick<Bill, 'label' | 'icon' | 'amount' | 'due' | 'repeat' | 'note'>

function BillForm({ initial, onSave, onCancel, onDelete }: { initial?: Bill; methods: string[]; onSave: (b: BillDraft) => void; onCancel: () => void; onDelete?: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '📅')
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [due, setDue] = useState(initial?.due ?? '')
  const [repeat, setRepeat] = useState<BillRepeat>(initial?.repeat ?? 'none')
  const [note, setNote] = useState(initial?.note ?? '')
  const n = Number(amount.replace(',', '.'))
  const valid = label.trim() && Number.isFinite(n) && n > 0 && /^\d{4}-\d{2}-\d{2}$/.test(due)
  const input = 'w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500'

  return (
    <Card>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSave({ label: label.trim(), icon: icon.trim() || '📅', amount: round2(n), due, repeat, note: note.trim() || undefined })
        }}
      >
        <div className="flex gap-2">
          <input value={icon} onChange={(e) => setIcon(e.target.value)} className={`${input} w-14 text-center`} aria-label="Ícono" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej. Seguro del carro" className={input} aria-label="Nombre" autoFocus={!initial} />
        </div>
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-slate-500">
            Monto
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="350" className={input} />
          </label>
          <label className="flex-1 text-xs text-slate-500">
            Vence
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
          </label>
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(REPEAT_LABEL) as BillRepeat[]).map((r) => (
            <button
              type="button"
              key={r}
              onClick={() => setRepeat(r)}
              className={`flex-1 rounded-full py-1.5 text-xs font-medium ring-1 ${repeat === r ? 'bg-emerald-600 text-white ring-emerald-600' : 'text-slate-600 ring-slate-300'}`}
            >
              {REPEAT_LABEL[r]}
            </button>
          ))}
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" className={input} aria-label="Nota" />
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={!valid} className="flex-1 rounded-xl bg-emerald-600 py-2 font-semibold text-white disabled:opacity-50">
            {initial ? 'Guardar' : 'Agendar'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-xl px-3 text-slate-500">
            Cancelar
          </button>
        </div>
        {onDelete && (
          <button type="button" onClick={onDelete} className="w-full pt-1 text-xs text-rose-600 underline">
            Quitar este pago
          </button>
        )}
      </form>
    </Card>
  )
}
