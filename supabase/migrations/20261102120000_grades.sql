-- M1-1: planilla de notas del docente.
-- grades guarda la nota vigente por alumno/materia/período (una fila por
-- combinación); grade_changes es la auditoría append-only de cada cambio.
-- RLS habilitado sin políticas: acceso exclusivo vía service role del backend.

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  period_id uuid not null references public.grading_periods (id) on delete cascade,
  value numeric(4,2) check (value between 1.00 and 10.00),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (student_id, subject_id, period_id)
);

create table public.grade_changes (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid references public.grades (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  previous_value numeric(4,2),
  new_value numeric(4,2),
  changed_by uuid not null references public.profiles (id),
  created_at timestamptz default now()
);

create index grades_institution_id_idx on public.grades (institution_id);
create index grades_student_id_idx on public.grades (student_id);
create index grades_subject_period_idx on public.grades (subject_id, period_id);
create index grade_changes_grade_id_idx on public.grade_changes (grade_id);
create index grade_changes_institution_id_idx on public.grade_changes (institution_id);

alter table public.grades enable row level security;
alter table public.grade_changes enable row level security;
