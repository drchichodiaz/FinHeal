import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('No se pudo entrar. Revisa el correo y la contraseña.')
    setBusy(false)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="text-5xl">🌱</div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">FinHeal</h1>
          <p className="text-sm text-slate-500">Sana tus finanzas, un gasto a la vez.</p>
        </div>
        <input
          type="email"
          autoComplete="email"
          required
          placeholder="Correo"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500"
        />
        <input
          type="password"
          autoComplete="current-password"
          required
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-emerald-500"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white active:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
