-- Alineación con las pantallas de UX:
-- * grades.observations: observación libre del docente por alumno/nota.
-- * notifications.type/link/student_id: categoría, deep-link y contexto de
--   alumno para que la app pueda clasificar y navegar desde cada aviso.
-- Cambios aditivos y retrocompatibles; sin políticas nuevas (acceso solo
-- vía service role del backend).

alter table public.grades
  add column observations text;

alter table public.notifications
  add column type text not null default 'general'
    check (type in ('grade', 'attendance', 'announcement', 'general')),
  add column link text,
  add column student_id uuid references public.students (id) on delete cascade;

create index notifications_student_id_idx on public.notifications (student_id);
