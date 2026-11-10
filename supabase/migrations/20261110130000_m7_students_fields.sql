-- M7-1: ABM de alumnos.
-- * document_number pasa a llamarse dni conservando los datos existentes.
-- * Ficha completa del alumno: legajo, datos personales, estado (baja lógica),
--   fecha de inscripción y observaciones académicas/institucionales.
-- * updated_at para ordenar/mostrar la última modificación en el listado.
-- * DNI único por institución (solo filas con dni no nulo) para impedir
--   alumnos duplicados dentro de la misma escuela.
-- Cambios aditivos y retrocompatibles; sin políticas nuevas (acceso solo
-- vía service role del backend).

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'document_number'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'dni'
  ) then
    alter table public.students rename column document_number to dni;
  end if;
end $$;

alter table public.students
  add column if not exists dni text,
  add column if not exists file_number text,
  add column if not exists birth_date date,
  add column if not exists gender text
    check (gender in ('Femenino', 'Masculino', 'Otro')),
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive', 'draft')),
  add column if not exists enrollment_date date default current_date,
  add column if not exists observation_academic text,
  add column if not exists observation_institutional text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_students_institution_dni
  on public.students (institution_id, dni)
  where dni is not null;

create index if not exists idx_students_search
  on public.students (institution_id, course_id, status);
