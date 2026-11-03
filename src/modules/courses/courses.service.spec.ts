import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { CoursesService } from './courses.service.js';

interface TableMock {
  results: unknown[];
  calls: { op: string; args: unknown[] }[];
}

function tables(init: Record<string, unknown[]>) {
  const state: Record<string, TableMock> = {};
  for (const [name, results] of Object.entries(init)) {
    state[name] = { results: [...results], calls: [] };
  }
  const db = {
    from: (t: string) => {
      const table = (state[t] ??= { results: [], calls: [] });
      const next = () =>
        table.results.shift() ?? { data: null, error: null };
      const q: any = {
        select: (...args: unknown[]) => (
          table.calls.push({ op: 'select', args }), q
        ),
        eq: (...args: unknown[]) => (
          table.calls.push({ op: 'eq', args }), q
        ),
        order: (...args: unknown[]) => (
          table.calls.push({ op: 'order', args }), q
        ),
        then: (res: any, rej: any) => Promise.resolve(next()).then(res, rej),
      };
      return q;
    },
  };
  return { db, state };
}

function service(init: Record<string, unknown[]>) {
  const { db, state } = tables(init);
  const svc = new CoursesService({ admin: db } as any);
  return { svc, state };
}

const INST = '11111111-2222-3333-4444-555555555555';

const teacher: Membership = {
  id: 'mT',
  userId: 'uT',
  institutionId: INST,
  role: 'teacher',
};

const guardian: Membership = {
  id: 'mG',
  userId: 'uG',
  institutionId: INST,
  role: 'guardian',
};

const admin: Membership = {
  id: 'mA',
  userId: 'uA',
  institutionId: INST,
  role: 'admin',
};

const director: Membership = {
  id: 'mD',
  userId: 'uD',
  institutionId: INST,
  role: 'director',
};

const rows = [
  {
    id: 'c1',
    name: '1° A',
    year: 1,
    division: 'A',
    shift: 'morning',
  },
  {
    id: 'c2',
    name: '1° B',
    year: 1,
    division: 'B',
    shift: 'afternoon',
  },
  {
    id: 'c3',
    name: '5° A',
    year: 5,
    division: 'A',
    shift: null,
  },
];

describe('CoursesService · list', () => {
  it('teacher o guardian → 403 sin consultar la base', async () => {
    for (const member of [teacher, guardian]) {
      const { svc, state } = service({});
      await expect(svc.list(member)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(state.courses?.calls ?? []).toEqual([]);
    }
  });

  it('admin y director → 200 OK con la lista de cursos', async () => {
    for (const member of [admin, director]) {
      const { svc } = service({
        courses: [{ data: rows, error: null }],
      });
      await expect(svc.list(member)).resolves.toEqual([
        {
          id: 'c1',
          name: '1° A',
          year: 1,
          division: 'A',
          shift: 'morning',
        },
        {
          id: 'c2',
          name: '1° B',
          year: 1,
          division: 'B',
          shift: 'afternoon',
        },
        {
          id: 'c3',
          name: '5° A',
          year: 5,
          division: 'A',
          shift: null,
        },
      ]);
    }
  });

  it('filtra por institution_id y ordena por year y division asc', async () => {
    const { svc, state } = service({
      courses: [{ data: rows, error: null }],
    });
    await svc.list(admin);
    expect(state.courses.calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    expect(
      state.courses.calls.filter((c) => c.op === 'order').map((c) => c.args),
    ).toEqual([['year'], ['division']]);
  });

  it('sin cursos → lista vacía', async () => {
    const { svc } = service({
      courses: [{ data: [], error: null }],
    });
    await expect(svc.list(admin)).resolves.toEqual([]);
  });
});
