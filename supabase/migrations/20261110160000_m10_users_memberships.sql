-- M10-1: Alta de usuarios y roles.
-- * memberships.status: pasa a representar el ciclo de vida de la membresía
--   ('active', 'inactive', 'pending', 'blocked') con default 'active'.
--   Se preservan además los valores heredados de M8 ('activo', 'licencia',
--   'inactivo') usados como estado laboral docente: las filas existentes
--   siguen siendo válidas y 'activo'/'licencia' cuentan como membresía
--   activa para la regla del último administrador.
-- * memberships.updated_at: última modificación de la membresía, para
--   ordenar/auditar y como fallback del "último acceso" del listado.
-- * profiles: full_name, first_name, last_name, dni, phone y address ya
--   fueron garantizadas por migraciones previas; se refuerzan con
--   IF NOT EXISTS para que el esquema quede completo aunque se aplique
--   sobre bases parciales.
-- * Índice (institution_id, role, status) para el listado administrativo
--   de usuarios y el conteo de administradores activos.
-- Cambios aditivos y retrocompatibles; sin políticas nuevas (acceso solo
-- vía service role del backend).

alter table public.memberships
  drop constraint if exists memberships_status_check;

alter table public.memberships
  add constraint memberships_status_check
  check (status in (
    'active', 'inactive', 'pending', 'blocked',
    'activo', 'licencia', 'inactivo'
  ));

alter table public.memberships
  alter column status set default 'active';

alter table public.memberships
  add column if not exists updated_at timestamptz default now();

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists dni text,
  add column if not exists phone text,
  add column if not exists address text;

create index if not exists idx_memberships_inst_role_status
  on public.memberships (institution_id, role, status);
