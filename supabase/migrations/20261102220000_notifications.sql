-- M4-1: notificaciones in-app para RedEduca.
-- notifications guarda los avisos dirigidos a un usuario (recipient) dentro
-- de una institución. RLS habilitado sin políticas: acceso exclusivo vía
-- service role del backend.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz default null,
  created_at timestamptz default now()
);

create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index notifications_recipient_read_idx on public.notifications (recipient_id, read_at);

alter table public.notifications enable row level security;
