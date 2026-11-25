import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Solo en el servidor. La service role key salta RLS: TODAS las consultas
// deben filtrar por user_id explicitamente (ver finheal.ts).
let admin: SupabaseClient | null = null

export function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  if (!url) throw new Error('Falta SUPABASE_URL')
  return url
}

export function adminDb(): SupabaseClient {
  if (admin) return admin
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY')
  admin = createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } })
  return admin
}

// Verifica correo y contrasena contra Supabase Auth y devuelve el id del usuario
export async function checkPassword(email: string, password: string): Promise<{ id: string; email: string } | null> {
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!anon) throw new Error('Falta SUPABASE_ANON_KEY')
  const client = createClient(supabaseUrl(), anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) return null
  await client.auth.signOut().catch(() => {})
  return { id: data.user.id, email: data.user.email ?? email }
}
