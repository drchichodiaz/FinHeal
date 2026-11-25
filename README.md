# FinHeal

> An app for healing your financial life.

App para anotar gastos en el momento, controlar sobres por quincena y ver cómo bajan tus deudas.
Stack: Vite + React + TypeScript + Tailwind v4 · Supabase (Postgres + Auth + RLS) · Vercel · PWA.

**Privacidad:** el código no contiene datos de nadie. Tu plan (sobres, montos, metas) y tus movimientos viven en tu propio proyecto de Supabase, protegidos con Row Level Security.

## 1. Supabase

1. Crea un proyecto en <https://supabase.com/dashboard> (elige la región más cercana).
2. **SQL Editor → New query** → pega todo [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Authentication → Users → Add user → Create new user**: tu correo y una contraseña, con **Auto Confirm User** marcado.
4. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up**.
5. **Project Settings → API Keys**: copia la URL, la *publishable/anon key* y la *secret/service_role key*.

## 2. Local

```bash
cp .env.example .env.local   # llena los 3 valores
npm install
npm run dev                  # http://localhost:5173 (también accesible desde tu Wi-Fi)
```

## 3. Tu plan

Opción A: en la app, pestaña **⚙️ Plan**: edita sobres, metas y reglas y guarda.

Opción B: carga un JSON que tengas **fuera del repo** (misma forma que `Plan` en [`src/lib/config.ts`](src/lib/config.ts)):

```bash
npm run seed-plan -- ../plan.json
```

## 4. Vercel

**Add New → Project → Import** el repo. En **Environment Variables** agrega solo:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

La service role key **nunca** va en Vercel ni en el repo.

## 5. En el celular

Abre la URL, inicia sesión y:
- **Android (Chrome):** menú ⋮ → *Agregar a pantalla principal*.
- **iPhone (Safari):** Compartir → *Agregar a inicio*.

## Exportar datos

```bash
npm run export   # escribe ../exports/finanzas-latest.json
```

También hay un botón **Exportar (CSV)** en la pestaña Historial.
