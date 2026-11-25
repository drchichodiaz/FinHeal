import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configMissing, supabase } from './lib/supabase'
import { useData } from './lib/useData'
import { Login } from './components/Login'
import { AddEntry } from './components/AddEntry'
import { Quincena } from './components/Quincena'
import { Metas } from './components/Metas'
import { Historial } from './components/Historial'
import { PlanEditor } from './components/PlanEditor'
import { Toast } from './components/ui'

type Tab = 'anotar' | 'quincena' | 'metas' | 'historial' | 'plan'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'anotar', label: 'Anotar', icon: '➕' },
  { id: 'quincena', label: 'Quincena', icon: '📊' },
  { id: 'metas', label: 'Metas', icon: '🎯' },
  { id: 'historial', label: 'Historial', icon: '🧾' },
  { id: 'plan', label: 'Plan', icon: '⚙️' },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('anotar')
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const { data, loading, error, reload } = useData(!!session)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  function notify(msg: string) {
    setToast(msg)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 2600)
    reload()
  }

  if (configMissing) {
    return (
      <div className="p-6 text-sm text-slate-700">
        Falta configurar <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> (ver README).
      </div>
    )
  }
  if (!ready) return null
  if (!session) return <Login />

  return (
    <div className="mx-auto min-h-dvh max-w-md bg-slate-50 pb-24">
      <Toast text={toast} />
      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <h1 className="text-lg font-bold text-slate-900">FinHeal</h1>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {loading && <span>Sincronizando…</span>}
          <button onClick={() => supabase.auth.signOut()} className="underline">
            Salir
          </button>
        </div>
      </header>

      {!loading && !error && !data.hasPlan && tab !== 'plan' && (
        <button onClick={() => setTab('plan')} className="mx-4 mb-2 block w-[calc(100%-2rem)] rounded-lg bg-amber-50 p-2 text-left text-sm text-amber-800">
          Aún no tienes un plan. Toca aquí para configurar tus sobres y metas →
        </button>
      )}

      {error && <div className="mx-4 mb-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">Error cargando datos: {error}</div>}

      <main className="px-4">
        {tab === 'anotar' && <AddEntry data={data} onSaved={notify} />}
        {tab === 'quincena' && <Quincena data={data} />}
        {tab === 'metas' && <Metas data={data} onSaved={notify} />}
        {tab === 'historial' && <Historial data={data} onChanged={notify} />}
        {tab === 'plan' && <PlanEditor data={data} onSaved={notify} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-col items-center py-2 text-xs font-medium ${tab === t.id ? 'text-emerald-700' : 'text-slate-500'}`}
            >
              <span className="text-xl">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
