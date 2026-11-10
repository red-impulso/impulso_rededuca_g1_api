-- M6-1: ABM de institución, cursos y materias.
-- * institutions.address: domicilio editable desde PATCH /institution.
-- * institutions.levels: niveles educativos de la institución (text[]).
-- * courses: unicidad de (institution_id, year, division, shift, school_year)
--   para impedir cursos duplicados dentro del mismo ciclo lectivo.
-- Cambios aditivos y retrocompatibles; sin políticas nuevas (acceso solo
-- vía service role del backend).

alter table public.institutions
  add column if not exists address text,
  add column if not exists levels text[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'courses_institution_year_division_shift_school_year_key'
      and conrelid = 'public.courses'::regclass
  ) then
    alter table public.courses
      add constraint courses_institution_year_division_shift_school_year_key
      unique (institution_id, year, division, shift, school_year);
  end if;
end $$;
