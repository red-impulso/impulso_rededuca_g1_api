-- M9-1: Vínculo tutor ↔ alumno.
-- * guardian_links: parentesco, flags de contacto (principal, emergencia,
--   responsable financiero), estado del vínculo (baja lógica consistente
--   con students) y updated_at para ordenar/auditar la última modificación.
-- * profiles: datos del tutor que necesita la ficha del alumno en M9-UX
--   (nombre y apellido separados, DNI y domicilio); se agregan de forma
--   aditiva sobre el full_name/phone existentes.
-- * Índice único (student_id, guardian_membership_id) para impedir vínculos
--   duplicados e índices de consulta por alumno y por tutor con su estado.
-- Cambios aditivos y retrocompatibles; sin políticas nuevas (acceso solo
-- vía service role del backend).

alter table public.guardian_links
  add column if not exists relationship text
    check (relationship in ('madre', 'padre', 'tutor-legal', 'encargado', 'familiar-autorizado', 'otro')),
  add column if not exists is_primary boolean not null default false,
  add column if not exists is_emergency_contact boolean not null default false,
  add column if not exists is_financial_responsible boolean not null default false,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive', 'pending')),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- relationship ya existía en el esquema base sin check ni default: el
-- ADD COLUMN IF NOT EXISTS no la toca, así que la restricción y el default
-- se garantizan aparte.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guardian_links_relationship_check'
      and conrelid = 'public.guardian_links'::regclass
  ) then
    alter table public.guardian_links
      add constraint guardian_links_relationship_check
      check (relationship in ('madre', 'padre', 'tutor-legal', 'encargado', 'familiar-autorizado', 'otro'));
  end if;
end $$;

alter table public.guardian_links
  alter column relationship set default 'familiar-autorizado';

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists dni text,
  add column if not exists address text;

create unique index if not exists idx_guardian_links_unique
  on public.guardian_links (student_id, guardian_membership_id);

create index if not exists idx_guardian_links_student
  on public.guardian_links (student_id, status);

create index if not exists idx_guardian_links_guardian
  on public.guardian_links (guardian_membership_id, status);
