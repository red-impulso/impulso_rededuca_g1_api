-- B-07: courses pasa a exponer year/division/shift según el contrato de la API.
-- Se conservan name y school_year; year se backfillea desde school_year para
-- las filas existentes antes de imponer NOT NULL.

alter table public.courses
  add column year integer,
  add column division text,
  add column shift text check (shift in ('morning', 'afternoon', 'evening'));

update public.courses set year = school_year where year is null;

alter table public.courses alter column year set not null;
