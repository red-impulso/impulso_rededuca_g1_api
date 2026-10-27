import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase', 'migrations');
const file = readdirSync(dir).find((f) => f.endsWith('_base_schema.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

const tables = [
  'institutions',
  'profiles',
  'memberships',
  'courses',
  'subjects',
  'students',
  'guardian_links',
  'grading_periods',
];

describe('migración base_schema', () => {
  it('existe', () => {
    expect(file).toBeDefined();
  });

  it.each(tables)('crea %s con RLS habilitado', (t) => {
    expect(sql).toContain(`create table public.${t} (`);
    expect(sql).toContain(`alter table public.${t} enable row level security;`);
  });

  it('no define políticas', () => {
    expect(sql).not.toMatch(/create policy/i);
  });

  it('restringe memberships.role', () => {
    expect(sql).toContain(
      "check (role in ('admin', 'director', 'teacher', 'guardian'))",
    );
  });

  it('define las unicidades pedidas', () => {
    expect(sql).toContain('unique (user_id, institution_id, role)');
    expect(sql).toContain('unique (guardian_membership_id, student_id)');
  });
});
