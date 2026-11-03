-- M2-1: asistencia diaria por curso.
-- attendance_records guarda el estado del día por alumno (una fila por
-- alumno/fecha). RLS habilitado sin políticas: acceso exclusivo vía
-- service role del backend.

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'justified')),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (student_id, date)
);

create index attendance_records_course_date_idx on public.attendance_records (course_id, date);
create index attendance_records_student_id_idx on public.attendance_records (student_id);

alter table public.attendance_records enable row level security;
