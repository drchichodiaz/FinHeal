-- Finanzas 2027 — esquema de base de datos
-- Pegar completo en Supabase > SQL Editor > New query > Run

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spent_on date not null default current_date,
  amount numeric(10, 2) not null check (amount > 0),
  category text not null,
  method text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  received_on date not null default current_date,
  amount numeric(10, 2) not null check (amount > 0),
  source text not null,
  note text,
  created_at timestamptz not null default now()
);

-- Cada fila es una foto del saldo de una meta (deuda, ahorro o por cobrar) en una fecha
create table if not exists public.balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  recorded_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_date on public.expenses (user_id, spent_on desc);
create index if not exists incomes_user_date on public.incomes (user_id, received_on desc);
create index if not exists balances_user_kind on public.balances (user_id, kind, recorded_on desc);

-- Seguridad: cada usuario solo ve y modifica sus propias filas
alter table public.expenses enable row level security;
alter table public.incomes enable row level security;
alter table public.balances enable row level security;

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own incomes" on public.incomes;
create policy "own incomes" on public.incomes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own balances" on public.balances;
create policy "own balances" on public.balances for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Plan personal (sobres, metas, reglas) guardado como JSON, uno por usuario
create table if not exists public.plans (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;

drop policy if exists "own plan" on public.plans;
create policy "own plan" on public.plans for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Permisos para la Data API (los proyectos nuevos de Supabase no los dan por defecto).
-- anon NO recibe nada: sin login no se puede leer ni escribir. RLS sigue filtrando por usuario.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.expenses, public.incomes, public.balances, public.plans to authenticated, service_role;
