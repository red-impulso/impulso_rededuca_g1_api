-- Alineación completa con el contrato del frontend (M6 a M10).
-- * institutions: ficha completa de la escuela (código, nivel, ubicación,
--   contacto, logo, ciclo lectivo, horarios y flags de funcionalidad) más
--   updated_at para auditar la última modificación y status del ciclo de
--   vida de la escuela para el selector del header.
-- * courses: aula física, estado del curso (baja lógica / borrador) y
--   docente preceptor (homeroom teacher) como FK a memberships.
-- * subjects: descripción libre, estado (baja lógica) y updated_at para
--   mostrar la última modificación en el listado.
-- * profiles.alt_phone: teléfono alternativo de tutores y contactos.
-- * memberships.blocked_reason: motivo del bloqueo para la UI de usuarios.
-- Índices para los nuevos filtros y relaciones.
-- Cambios aditivos y retrocompatibles; sin políticas nuevas (acceso solo
-- vía service role del backend).

alter table public.institutions
  add column if not exists code text,
  add column if not exists level text,
  add column if not exists city text,
  add column if not exists province text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists logo_url text,
  add column if not exists school_year integer not null default 2026,
  add column if not exists schedule jsonb,
  add column if not exists family_communications boolean not null default true,
  add column if not exists daily_attendance boolean not null default true,
  add column if not exists status text not null default 'activa'
    check (status in ('activa', 'en-implementacion', 'suspendida')),
  add column if not exists updated_at timestamptz not null default now();

alter table public.courses
  add column if not exists classroom text,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive', 'draft')),
  add column if not exists homeroom_teacher_membership_id uuid
    references public.memberships (id) on delete set null;

alter table public.subjects
  add column if not exists description text,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive')),
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  add column if not exists alt_phone text;

alter table public.memberships
  add column if not exists blocked_reason text;

create index if not exists idx_courses_homeroom_teacher
  on public.courses (homeroom_teacher_membership_id);

create index if not exists idx_courses_status
  on public.courses (institution_id, status);

create index if not exists idx_subjects_status
  on public.subjects (status);

create index if not exists idx_memberships_blocked
  on public.memberships (institution_id, status)
  where status = 'blocked';
