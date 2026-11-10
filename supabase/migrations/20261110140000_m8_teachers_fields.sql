-- M8-1: Asignación de docentes.
-- * memberships: datos laborales del rol docente (legajo, situación de
--   revista, estado, límite de carga horaria semanal y fecha de alta).
--   Viven en memberships (no en profiles) porque son datos por institución:
--   el mismo usuario puede ser docente en varias escuelas con legajo y
--   condición distintos.
-- * subjects.weekly_hours: carga horaria semanal de la materia para el
--   cálculo de horas de las pantallas de asignación.
-- * subjects.teacher_membership_id ya existe desde el esquema base
--   (FK a memberships ON DELETE SET NULL); se garantiza con IF NOT EXISTS.
-- Índices para el listado de docentes por institución/rol y la búsqueda de
-- materias por docente.
-- Cambios aditivos y retrocompatibles; sin políticas nuevas (acceso solo
-- vía service role del backend).

alter table public.memberships
  add column if not exists file_number text,
  add column if not exists employment_status text not null default 'titular'
    check (employment_status in ('titular', 'interino', 'suplente')),
  add column if not exists status text not null default 'activo'
    check (status in ('activo', 'licencia', 'inactivo')),
  add column if not exists max_weekly_hours integer not null default 30,
  add column if not exists hired_at date;

alter table public.subjects
  add column if not exists teacher_membership_id uuid
    references public.memberships (id) on delete set null,
  add column if not exists weekly_hours integer not null default 4;

create index if not exists idx_memberships_institution_role
  on public.memberships (institution_id, role);

create index if not exists idx_subjects_teacher
  on public.subjects (teacher_membership_id);
