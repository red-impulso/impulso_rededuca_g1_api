import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
        in: (...args: unknown[]) => (
          table.calls.push({ op: 'in', args }), q
        ),
        order: (...args: unknown[]) => (
          table.calls.push({ op: 'order', args }), q
        ),
        insert: (...args: unknown[]) => (
          table.calls.push({ op: 'insert', args }), q
        ),
        update: (...args: unknown[]) => (
          table.calls.push({ op: 'update', args }), q
        ),
        delete: (...args: unknown[]) => (
          table.calls.push({ op: 'delete', args }), q
        ),
        single: () => Promise.resolve(next()),
        maybeSingle: () => Promise.resolve(next()),
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
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const COURSE2 = 'dddddddd-1111-2222-3333-444444444445';

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
    school_year: 2026,
  },
  {
    id: 'c2',
    name: '1° B',
    year: 1,
    division: 'B',
    shift: 'afternoon',
    school_year: 2026,
  },
  {
    id: 'c3',
    name: '5° A',
    year: 5,
    division: 'A',
    shift: null,
    school_year: 2025,
  },
];

const createDto = {
  year: 1,
  division: 'A',
  shift: 'morning' as const,
  schoolYear: 2026,
};

const createdRow = {
  id: COURSE,
  name: '1° A',
  year: 1,
  division: 'A',
  shift: 'morning',
  school_year: 2026,
};

const courseRow = {
  id: COURSE,
  name: '2° B',
  year: 2,
  division: 'B',
  shift: 'afternoon',
  school_year: 2026,
};

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
          schoolYear: 2026,
          classroom: null,
          status: 'active',
          studentsCount: 0,
          homeroomTeacher: null,
        },
        {
          id: 'c2',
          name: '1° B',
          year: 1,
          division: 'B',
          shift: 'afternoon',
          schoolYear: 2026,
          classroom: null,
          status: 'active',
          studentsCount: 0,
          homeroomTeacher: null,
        },
        {
          id: 'c3',
          name: '5° A',
          year: 5,
          division: 'A',
          shift: null,
          schoolYear: 2025,
          classroom: null,
          status: 'active',
          studentsCount: 0,
          homeroomTeacher: null,
        },
      ]);
    }
  });

  it('filtra por institución y ordena school_year DESC, year y division ASC', async () => {
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
    ).toEqual([
      ['school_year', { ascending: false }],
      ['year'],
      ['division'],
    ]);
  });

  it('sin cursos → lista vacía', async () => {
    const { svc } = service({
      courses: [{ data: [], error: null }],
    });
    await expect(svc.list(admin)).resolves.toEqual([]);
  });
});

describe('CoursesService · create', () => {
  it('crea el curso con nombre derivado e institution_id', async () => {
    const { svc, state } = service({
      courses: [
        { data: [], error: null },
        { data: createdRow, error: null },
      ],
    });
    await expect(svc.create(admin, createDto)).resolves.toEqual({
      id: COURSE,
      name: '1° A',
      year: 1,
      division: 'A',
      shift: 'morning',
      schoolYear: 2026,
      classroom: null,
      status: 'active',
      studentsCount: 0,
      homeroomTeacher: null,
    });
    const insert = state.courses.calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toEqual({
      institution_id: INST,
      name: '1° A',
      year: 1,
      division: 'A',
      shift: 'morning',
      school_year: 2026,
    });
  });

  it('admin y director → crean sin problema', async () => {
    for (const member of [admin, director]) {
      const { svc } = service({
        courses: [
          { data: [], error: null },
          { data: createdRow, error: null },
        ],
      });
      await expect(svc.create(member, createDto)).resolves.toMatchObject({
        id: COURSE,
      });
    }
  });

  it('duplicado (mismo año, división, turno y ciclo) → 409 y no inserta', async () => {
    const { svc, state } = service({
      courses: [{ data: [{ id: COURSE2, shift: 'morning' }], error: null }],
    });
    await expect(svc.create(admin, createDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      state.courses.calls.some((c) => c.op === 'insert'),
    ).toBe(false);
  });

  it('misma clave pero otro turno → no es duplicado', async () => {
    const { svc } = service({
      courses: [
        { data: [{ id: COURSE2, shift: 'afternoon' }], error: null },
        { data: createdRow, error: null },
      ],
    });
    await expect(
      svc.create(admin, createDto),
    ).resolves.toMatchObject({ id: COURSE });
  });

  it('violación de unicidad de Postgres (23505) → 409', async () => {
    const { svc } = service({
      courses: [
        { data: [], error: null },
        { data: null, error: { code: '23505' } },
      ],
    });
    await expect(svc.create(admin, createDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403 y no consulta la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.create(member, createDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.courses?.calls ?? []).toEqual([]);
  });

  it.each([
    ['year 0', { ...createDto, year: 0 }],
    ['year decimal', { ...createDto, year: 1.5 }],
    ['division vacía', { ...createDto, division: '  ' }],
    ['shift inválido', { ...createDto, shift: 'night' as any }],
    ['schoolYear inválido', { ...createDto, schoolYear: 20 }],
  ])('body inválido: %s → 400 sin escribir', async (_n, dto) => {
    const { svc, state } = service({});
    await expect(svc.create(admin, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.courses?.calls ?? []).toEqual([]);
  });
});

describe('CoursesService · update', () => {
  it('actualiza campos y regenera el nombre', async () => {
    const updated = { ...courseRow, division: 'C', name: '2° C' };
    const { svc, state } = service({
      courses: [
        { data: courseRow, error: null },
        { data: [], error: null },
        { data: updated, error: null },
      ],
    });
    await expect(
      svc.update(admin, COURSE, { division: 'C' }),
    ).resolves.toEqual({
      id: COURSE,
      name: '2° C',
      year: 2,
      division: 'C',
      shift: 'afternoon',
      schoolYear: 2026,
      classroom: null,
      status: 'active',
      studentsCount: 0,
      homeroomTeacher: null,
    });
    const upd = state.courses.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toMatchObject({ division: 'C', name: '2° C' });
  });

  it('colisión con otro curso → 409 y no actualiza', async () => {
    const { svc, state } = service({
      courses: [
        { data: courseRow, error: null },
        { data: [{ id: COURSE2, shift: 'morning' }], error: null },
      ],
    });
    await expect(
      svc.update(admin, COURSE, { shift: 'morning' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.courses.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('mismo curso sin cambios de clave → no cuenta como duplicado', async () => {
    const { svc } = service({
      courses: [
        { data: courseRow, error: null },
        { data: [{ id: COURSE, shift: 'afternoon' }], error: null },
        { data: courseRow, error: null },
      ],
    });
    await expect(
      svc.update(admin, COURSE, { division: 'B' }),
    ).resolves.toMatchObject({ id: COURSE });
  });

  it('curso inexistente o de otra institución → 404', async () => {
    const { svc } = service({
      courses: [{ data: null, error: null }],
    });
    await expect(
      svc.update(admin, COURSE, { division: 'C' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('id inválido → 400', async () => {
    const { svc } = service({});
    await expect(
      svc.update(admin, 'no-es-uuid', { division: 'C' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dto vacío → 400', async () => {
    const { svc } = service({
      courses: [{ data: courseRow, error: null }],
    });
    await expect(svc.update(admin, COURSE, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403', async (_n, member) => {
    const { svc } = service({});
    await expect(
      svc.update(member, COURSE, { division: 'C' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CoursesService · remove', () => {
  it('curso con alumnos → 409 con mensaje claro y no borra', async () => {
    const { svc, state } = service({
      courses: [{ data: courseRow, error: null }],
      students: [{ data: null, count: 3, error: null }],
    });
    await expect(svc.remove(admin, COURSE)).rejects.toThrow(
      'No se puede eliminar el curso porque tiene alumnos asignados',
    );
    expect(state.courses.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('curso sin alumnos → elimina físicamente (204)', async () => {
    const { svc, state } = service({
      courses: [
        { data: courseRow, error: null },
        { data: null, error: null },
      ],
      students: [{ data: null, count: 0, error: null }],
    });
    await expect(svc.remove(admin, COURSE)).resolves.toBeUndefined();
    expect(state.courses.calls.some((c) => c.op === 'delete')).toBe(true);
    expect(state.students.calls).toContainEqual({
      op: 'eq',
      args: ['course_id', COURSE],
    });
  });

  it('admin y director → pueden eliminar', async () => {
    for (const member of [admin, director]) {
      const { svc } = service({
        courses: [
          { data: courseRow, error: null },
          { data: null, error: null },
        ],
        students: [{ data: null, count: 0, error: null }],
      });
      await expect(svc.remove(member, COURSE)).resolves.toBeUndefined();
    }
  });

  it('curso inexistente o de otra institución → 404', async () => {
    const { svc } = service({
      courses: [{ data: null, error: null }],
    });
    await expect(svc.remove(admin, COURSE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('id inválido → 400', async () => {
    const { svc } = service({});
    await expect(svc.remove(admin, 'no-es-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403 y no borra', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.remove(member, COURSE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.courses?.calls ?? []).toEqual([]);
  });
});

describe('CoursesService · detail (GET /courses/:id)', () => {
  it('devuelve el detalle con studentsCount y homeroomTeacher', async () => {
    const { svc } = service({
      courses: [
        {
          data: {
            ...rows[0],
            id: COURSE,
            classroom: 'Sala 12',
            status: 'active',
            homeroom_teacher_membership_id:
              'aaaaaaaa-0000-0000-0000-000000000001',
          },
          error: null,
        },
      ],
      students: [
        {
          data: [{ course_id: COURSE }, { course_id: COURSE }],
          error: null,
        },
      ],
      memberships: [
        {
          data: [
            {
              id: 'aaaaaaaa-0000-0000-0000-000000000001',
              user_id: 'uT1',
            },
          ],
          error: null,
        },
      ],
      profiles: [
        { data: [{ id: 'uT1', full_name: 'Laura Gómez' }], error: null },
      ],
    });
    await expect(svc.detail(admin, COURSE)).resolves.toEqual({
      id: COURSE,
      name: '1° A',
      year: 1,
      division: 'A',
      shift: 'morning',
      schoolYear: 2026,
      classroom: 'Sala 12',
      status: 'active',
      studentsCount: 2,
      homeroomTeacher: {
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        fullName: 'Laura Gómez',
      },
    });
  });

  it('curso inexistente → 404', async () => {
    const { svc } = service({
      courses: [{ data: null, error: null }],
    });
    await expect(svc.detail(admin, COURSE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
