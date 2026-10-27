-- Esquema base de RedEduca: instituciones, usuarios, cursos, alumnos y tutores.
-- RLS queda habilitado en todas las tablas SIN políticas (denegar todo por defecto);
-- las políticas se agregan en migraciones posteriores.

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  role text not null check (role in ('admin', 'director', 'teacher', 'guardian')),
  created_at timestamptz not null default now(),
  unique (user_id, institution_id, role)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  name text not null,
  school_year integer not null,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  teacher_membership_id uuid references public.memberships (id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  first_name text not null,
  last_name text not null,
  document_number text,
  birth_date date,
  created_at timestamptz not null default now()
);

create table public.guardian_links (
  id uuid primary key default gen_random_uuid(),
  guardian_membership_id uuid not null references public.memberships (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  relationship text,
  created_at timestamptz not null default now(),
  unique (guardian_membership_id, student_id)
);

create table public.grading_periods (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index memberships_institution_id_idx on public.memberships (institution_id);
create index courses_institution_id_idx on public.courses (institution_id);
create index subjects_course_id_idx on public.subjects (course_id);
create index students_institution_id_idx on public.students (institution_id);
create index students_course_id_idx on public.students (course_id);
create index guardian_links_student_id_idx on public.guardian_links (student_id);
create index grading_periods_institution_id_idx on public.grading_periods (institution_id);

alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.courses enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.guardian_links enable row level security;
alter table public.grading_periods enable row level security;
