-- M3-1: comunicados para RedEduca.
-- announcements guarda los comunicados con alcance institución, curso o
-- alumno. RLS habilitado sin políticas: acceso exclusivo vía service role
-- del backend.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  scope text not null check (scope in ('institution', 'course', 'student')),
  course_id uuid references public.courses (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (scope <> 'course' or course_id is not null),
  check (scope <> 'student' or student_id is not null)
);

create index announcements_institution_created_idx on public.announcements (institution_id, created_at desc);
create index announcements_course_id_idx on public.announcements (course_id);
create index announcements_student_id_idx on public.announcements (student_id);

alter table public.announcements enable row level security;
