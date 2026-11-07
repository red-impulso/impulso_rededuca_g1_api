-- BONUS-1/BONUS-2: leads del formulario público de contacto.
-- RLS habilitado sin políticas: acceso exclusivo vía service role
-- del backend.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  institution_name text not null,
  contact_name text not null,
  city text not null,
  contact_role text not null,
  level text not null check (level in ('Inicial', 'Primario', 'Secundario', 'Terciario / Superior')),
  contact_channel text not null,
  student_count int not null check (student_count between 1 and 100000),
  comment text,
  status text not null default 'new' check (status in ('new', 'contacted', 'discarded')),
  privacy_accepted_at timestamptz not null,
  created_at timestamptz default now()
);

create index leads_status_created_idx on public.leads (status, created_at desc);

alter table public.leads enable row level security;
