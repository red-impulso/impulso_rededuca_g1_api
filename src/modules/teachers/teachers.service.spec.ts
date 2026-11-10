import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { TeachersService } from './teachers.service.js';

interface TableMock {
  results: unknown[];
  calls: { op: string; args: unknown[] }[];
}

function tables(init: Record<string, unknown[]>) {
  const state: Record<string, TableMock> = {};
  for (const [name, results] of Object.entries(init)) {
    state[name] = { results: [...results], calls: [] };
  }
  const db: any = {
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
        not: (...args: unknown[]) => (
          table.calls.push({ op: 'not', args }), q
        ),
        or: (...args: unknown[]) => (
          table.calls.push({ op: 'or', args }), q
        ),
        ilike: (...args: unknown[]) => (
          table.calls.push({ op: 'ilike', args }), q
        ),
        range: (...args: unknown[]) => (
          table.calls.push({ op: 'range', args }), q
        ),
        order: (...args: unknown[]) => (
          table.calls.push({ op: 'order', args }), q
        ),
        limit: (...args: unknown[]) => (
          table.calls.push({ op: 'limit', args }), q
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

function service(
  init: Record<string, unknown[]>,
  emails: Record<string, string> = {},
) {
  const { db, state } = tables(init);
  const getUserById = vi.fn((id: string) =>
    Promise.resolve({
      data: { user: { id, email: emails[id] ?? null } },
      error: null,
    }),
  );
  db.auth = { admin: { getUserById } };
  const svc = new TeachersService({ admin: db } as any);
  return { svc, state, getUserById };
}

const INST = '11111111-2222-3333-4444-555555555555';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const M_ADMIN = 'bbbbbbbb-0000-0000-0000-000000000009';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const COURSE2 = 'dddddddd-1111-2222-3333-444444444445';
const SUBJ = 'eeeeeeee-0000-0000-0000-000000000001';
const SUBJ2 = 'eeeeeeee-0000-0000-0000-000000000002';

const teacherRole: Membership = {
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

const teacherRow = {
  id: T1,
  user_id: 'uT1',
  file_number: 'L-1042',
  employment_status: 'titular',
  status: 'activo',
  max_weekly_hours: 30,
  hired_at: '2020-03-01',
  created_at: '2026-01-01T00:00:00Z',
  profiles: { full_name: 'Laura Pérez', phone: '1155667788' },
};

const courseRef = {
  id: COURSE,
  name: '3ro B',
  year: 3,
  division: 'B',
  shift: 'morning',
  school_year: 2026,
  institution_id: INST,
};

const subjectRows = [
  {
    id: SUBJ,
    name: 'Matemática',
    weekly_hours: 6,
    teacher_membership_id: T1,
    course_id: COURSE,
    courses: courseRef,
  },
  {
    id: SUBJ2,
    name: 'Física',
    weekly_hours: 4,
    teacher_membership_id: T1,
    course_id: COURSE2,
    courses: {
      ...courseRef,
      id: COURSE2,
      name: '5to A',
      year: 5,
      division: 'A',
    },
  },
];

describe('TeachersService · list', () => {
  it.each([
    ['teacher', teacherRole],
    ['guardian', guardian],
  ])('rol %s → 403 sin consultar la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.list(member, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.memberships?.calls ?? []).toEqual([]);
  });

  it('devuelve docentes con materias mapeadas y carga horaria calculada', async () => {
    const { svc } = service(
      {
        courses: [{ data: [{ school_year: 2026 }], error: null }],
        memberships: [{ data: [teacherRow], count: 1, error: null }],
        subjects: [{ data: subjectRows, error: null }],
      },
      { uT1: 'laura@mail.com' },
    );

    await expect(svc.list(admin, {})).resolves.toEqual({
      data: [
        {
          id: T1,
          fullName: 'Laura Pérez',
          email: 'laura@mail.com',
          phone: '1155667788',
          fileNumber: 'L-1042',
          employmentStatus: 'titular',
          status: 'activo',
          coursesCount: 2,
          subjects: [
            {
              id: SUBJ,
              name: 'Matemática',
              weeklyHours: 6,
              course: {
                id: COURSE,
                name: '3ro B',
                year: 3,
                division: 'B',
                shift: 'morning',
              },
            },
            {
              id: SUBJ2,
              name: 'Física',
              weeklyHours: 4,
              course: {
                id: COURSE2,
                name: '5to A',
                year: 5,
                division: 'A',
                shift: 'morning',
              },
            },
          ],
          weeklyHours: 10,
          maxWeeklyHours: 30,
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
  });

  it('filtra por institución y rol teacher con paginación por defecto', async () => {
    const { svc, state } = service({
      courses: [{ data: [{ school_year: 2026 }], error: null }],
      memberships: [{ data: [], count: 0, error: null }],
    });
    await svc.list(director, {});
    const calls = state.memberships.calls;
    expect(calls).toContainEqual({ op: 'eq', args: ['institution_id', INST] });
    expect(calls).toContainEqual({ op: 'eq', args: ['role', 'teacher'] });
    expect(calls).toContainEqual({ op: 'range', args: [0, 24] });
    expect(calls).toContainEqual({
      op: 'select',
      args: [expect.any(String), { count: 'exact' }],
    });
  });

  it('las materias se limitan al ciclo lectivo activo (máx school_year)', async () => {
    const { svc, state } = service({
      courses: [{ data: [{ school_year: 2026 }], error: null }],
      memberships: [{ data: [teacherRow], count: 1, error: null }],
      subjects: [{ data: [], error: null }],
    });
    await svc.list(admin, {});
    expect(state.subjects.calls).toContainEqual({
      op: 'eq',
      args: ['courses.institution_id', INST],
    });
    expect(state.subjects.calls).toContainEqual({
      op: 'eq',
      args: ['courses.school_year', 2026],
    });
  });

  it('filtra por status y employmentStatus', async () => {
    const { svc, state } = service({
      courses: [{ data: [{ school_year: 2026 }], error: null }],
      memberships: [{ data: [], count: 0, error: null }],
    });
    await svc.list(admin, {
      status: 'licencia',
      employmentStatus: 'interino',
      page: 2,
    });
    const calls = state.memberships.calls;
    expect(calls).toContainEqual({ op: 'eq', args: ['status', 'licencia'] });
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['employment_status', 'interino'],
    });
    expect(calls).toContainEqual({ op: 'range', args: [25, 49] });
  });

  it('q busca por legajo o por nombre de perfil', async () => {
    const { svc, state } = service({
      courses: [{ data: [{ school_year: 2026 }], error: null }],
      profiles: [{ data: [{ id: 'uT1' }], error: null }],
      memberships: [
        { data: [{ id: T1 }], error: null },
        { data: [teacherRow], count: 1, error: null },
      ],
      subjects: [{ data: [], error: null }],
    });
    const result = await svc.list(admin, { q: 'lau' });

    expect(state.profiles.calls).toContainEqual({
      op: 'ilike',
      args: ['full_name', '%lau%'],
    });
    const orCall = state.memberships.calls.find((c) => c.op === 'or');
    expect(orCall?.args[0]).toBe(
      'file_number.ilike.%lau%,user_id.in.(uT1)',
    );
    expect(state.memberships.calls).toContainEqual({
      op: 'in',
      args: ['id', [T1]],
    });
    expect(result.data).toHaveLength(1);
  });

  it('q sin coincidencias → página vacía sin consultar docentes', async () => {
    const { svc, state } = service({
      courses: [{ data: [{ school_year: 2026 }], error: null }],
      profiles: [{ data: [], error: null }],
      memberships: [{ data: [], error: null }],
    });
    await expect(svc.list(admin, { q: 'zzz' })).resolves.toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    expect(state.memberships.calls.some((c) => c.op === 'range')).toBe(false);
  });

  it('courseId filtra docentes que dictan en ese curso', async () => {
    const { svc, state } = service({
      courses: [{ data: [{ school_year: 2026 }], error: null }],
      subjects: [
        { data: [{ teacher_membership_id: T1 }], error: null },
        { data: [], error: null },
      ],
      memberships: [{ data: [teacherRow], count: 1, error: null }],
    });
    await svc.list(admin, { courseId: COURSE });
    const teaching = state.subjects.calls;
    expect(teaching).toContainEqual({ op: 'eq', args: ['course_id', COURSE] });
    expect(state.memberships.calls).toContainEqual({
      op: 'in',
      args: ['id', [T1]],
    });
  });

  it.each([
    ['status inválido', { status: 'baja' }],
    ['employmentStatus inválido', { employmentStatus: 'efectivo' }],
    ['courseId inválido', { courseId: 'no-uuid' }],
    ['subjectId inválido', { subjectId: 'no-uuid' }],
    ['page < 1', { page: 0 }],
    ['limit > 100', { limit: 500 }],
  ])('parámetro inválido: %s → 400', async (_n, params) => {
    const { svc } = service({});
    await expect(svc.list(admin, params)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('TeachersService · detail', () => {
  const tablesForDetail = (overrides: Record<string, unknown[]> = {}) => ({
    memberships: [{ data: teacherRow, error: null }],
    courses: [{ data: [{ school_year: 2026 }], error: null }],
    subjects: [{ data: subjectRows, error: null }],
    students: [{ data: null, count: 42, error: null }],
    ...overrides,
  });

  it('arma la ficha con KPIs, materias y antigüedad', async () => {
    const { svc } = service(tablesForDetail(), { uT1: 'laura@mail.com' });
    const detail = await svc.detail(admin, T1);

    expect(detail).toMatchObject({
      id: T1,
      fullName: 'Laura Pérez',
      email: 'laura@mail.com',
      phone: '1155667788',
      fileNumber: 'L-1042',
      employmentStatus: 'titular',
      status: 'activo',
      hiredAt: '2020-03-01',
      kpis: {
        weeklyHours: 10,
        maxWeeklyHours: 30,
        subjectsCount: 2,
        coursesCount: 2,
        studentsReached: 42,
      },
      schedule: [],
    });
    expect(detail.subjects).toHaveLength(2);
    expect(detail.subjects[0].course).toMatchObject({
      id: COURSE,
      schoolYear: 2026,
      shift: 'morning',
    });
    expect(detail.seniority).not.toBeNull();
    expect(detail.seniority!.years).toBeGreaterThanOrEqual(5);
  });

  it('sin hired_at → antigüedad null', async () => {
    const { svc } = service(
      tablesForDetail({
        memberships: [
          { data: { ...teacherRow, hired_at: null }, error: null },
        ],
      }),
    );
    const detail = await svc.detail(admin, T1);
    expect(detail.seniority).toBeNull();
  });

  it('sin materias ni alumnos → KPIs en cero', async () => {
    const { svc } = service(
      tablesForDetail({ subjects: [{ data: [], error: null }] }),
    );
    const detail = await svc.detail(admin, T1);
    expect(detail.kpis).toEqual({
      weeklyHours: 0,
      maxWeeklyHours: 30,
      subjectsCount: 0,
      coursesCount: 0,
      studentsReached: 0,
    });
    expect(detail.subjects).toEqual([]);
  });

  it('docente inexistente o de otra institución → 404', async () => {
    const { svc } = service({ memberships: [{ data: null, error: null }] });
    await expect(svc.detail(admin, T1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('id inválido → 400', async () => {
    const { svc } = service({});
    await expect(svc.detail(admin, 'no-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacherRole],
    ['guardian', guardian],
  ])('rol %s → 403', async (_n, member) => {
    const { svc } = service({});
    await expect(svc.detail(member, T1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('TeachersService · update', () => {
  it('edita datos laborales y devuelve el registro', async () => {
    const { svc, state } = service(
      {
        memberships: [
          { data: teacherRow, error: null },
          {
            data: {
              ...teacherRow,
              file_number: 'L-2000',
              status: 'licencia',
              max_weekly_hours: 20,
            },
            error: null,
          },
        ],
      },
      { uT1: 'laura@mail.com' },
    );
    await expect(
      svc.update(admin, T1, {
        fileNumber: 'L-2000',
        status: 'licencia',
        maxWeeklyHours: 20,
      }),
    ).resolves.toMatchObject({
      id: T1,
      fileNumber: 'L-2000',
      status: 'licencia',
      maxWeeklyHours: 20,
    });
    const upd = state.memberships.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toEqual({
      file_number: 'L-2000',
      status: 'licencia',
      max_weekly_hours: 20,
    });
  });

  it('docente inexistente o de otra institución → 404 y no escribe', async () => {
    const { svc, state } = service({
      memberships: [{ data: null, error: null }],
    });
    await expect(
      svc.update(admin, T1, { fileNumber: 'L-9' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(state.memberships.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('dto vacío → 400', async () => {
    const { svc } = service({
      memberships: [{ data: teacherRow, error: null }],
    });
    await expect(svc.update(admin, T1, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacherRole],
    ['guardian', guardian],
  ])('rol %s → 403', async (_n, member) => {
    const { svc } = service({});
    await expect(
      svc.update(member, T1, { fileNumber: 'L-9' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TeachersService · assignTeacher (PUT /subjects/:id/teacher)', () => {
  const subjectFound = {
    data: { id: SUBJ, course_id: COURSE, courses: { id: COURSE } },
    error: null,
  };
  const updatedSubject = {
    ...subjectRows[0],
    teacher_membership_id: T1,
  };

  it('membresía sin rol teacher → 400 (caso clave del backlog)', async () => {
    const { svc, state } = service({
      subjects: [subjectFound],
      memberships: [
        {
          data: { id: M_ADMIN, user_id: 'uA', role: 'admin' },
          error: null,
        },
      ],
    });
    const attempt = svc.assignTeacher(admin, SUBJ, {
      teacherMembershipId: M_ADMIN,
    });
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(
      'La membresía asignada debe tener rol de docente',
    );
    expect(state.subjects.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it.each(['director', 'guardian'])(
    'rol %s también se rechaza con 400',
    async (role) => {
      const { svc } = service({
        subjects: [subjectFound],
        memberships: [
          { data: { id: M_ADMIN, user_id: 'uX', role }, error: null },
        ],
      });
      await expect(
        svc.assignTeacher(admin, SUBJ, { teacherMembershipId: M_ADMIN }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('teacherMembershipId válido → actualiza y devuelve la materia', async () => {
    const { svc, state } = service({
      subjects: [subjectFound, { data: updatedSubject, error: null }],
      memberships: [
        { data: { id: T1, user_id: 'uT1', role: 'teacher' }, error: null },
      ],
      profiles: [{ data: { id: 'uT1', full_name: 'Laura Pérez' }, error: null }],
    });
    await expect(
      svc.assignTeacher(director, SUBJ, { teacherMembershipId: T1 }),
    ).resolves.toMatchObject({
      id: SUBJ,
      name: 'Matemática',
      weeklyHours: 6,
      teacher: { id: T1, fullName: 'Laura Pérez' },
    });
    const upd = state.subjects.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toEqual({ teacher_membership_id: T1 });
  });

  it('teacherMembershipId null → desasigna al docente', async () => {
    const unassigned = { ...updatedSubject, teacher_membership_id: null };
    const { svc, state } = service({
      subjects: [subjectFound, { data: unassigned, error: null }],
    });
    await expect(
      svc.assignTeacher(admin, SUBJ, { teacherMembershipId: null }),
    ).resolves.toMatchObject({ id: SUBJ, teacher: null });
    const upd = state.subjects.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toEqual({ teacher_membership_id: null });
    // No consulta membresías: la desasignación no valida rol.
    expect(state.memberships?.calls ?? []).toEqual([]);
  });

  it('materia de otra institución o inexistente → 404', async () => {
    const { svc, state } = service({
      subjects: [{ data: null, error: null }],
    });
    await expect(
      svc.assignTeacher(admin, SUBJ, { teacherMembershipId: T1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(state.subjects.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('membresía de otra institución o inexistente → 400', async () => {
    const { svc } = service({
      subjects: [subjectFound],
      memberships: [{ data: null, error: null }],
    });
    await expect(
      svc.assignTeacher(admin, SUBJ, { teacherMembershipId: T1 }),
    ).rejects.toThrow('La membresía asignada no pertenece a la institución');
  });

  it.each([
    ['subjectId inválido', 'no-uuid', T1],
    ['teacherMembershipId inválido', SUBJ, 'no-uuid'],
  ])('%s → 400', async (_n, subjectId, teacherId) => {
    const { svc } = service({ subjects: [subjectFound] });
    await expect(
      svc.assignTeacher(admin, subjectId, { teacherMembershipId: teacherId }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['teacher', teacherRole],
    ['guardian', guardian],
  ])('rol %s → 403 sin consultar la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(
      svc.assignTeacher(member, SUBJ, { teacherMembershipId: T1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.subjects?.calls ?? []).toEqual([]);
  });
});

describe('TeachersService · courseAssignments', () => {
  const courseRow = {
    id: COURSE,
    name: '3ro B',
    year: 3,
    division: 'B',
    shift: 'morning',
    school_year: 2026,
  };

  it('devuelve las materias del curso con docente y carga horaria', async () => {
    const { svc } = service({
      courses: [{ data: courseRow, error: null }],
      subjects: [
        {
          data: [
            {
              id: SUBJ,
              name: 'Matemática',
              weekly_hours: 6,
              teacher_membership_id: T1,
            },
            {
              id: SUBJ2,
              name: 'Lengua',
              weekly_hours: null,
              teacher_membership_id: null,
            },
          ],
          error: null,
        },
      ],
      memberships: [{ data: [{ id: T1, user_id: 'uT1' }], error: null }],
      profiles: [
        { data: [{ id: 'uT1', full_name: 'Laura Pérez' }], error: null },
      ],
    });
    await expect(svc.courseAssignments(admin, COURSE)).resolves.toEqual({
      course: {
        id: COURSE,
        name: '3ro B',
        year: 3,
        division: 'B',
        shift: 'morning',
        schoolYear: 2026,
      },
      subjects: [
        {
          id: SUBJ,
          name: 'Matemática',
          weeklyHours: 6,
          teacher: { id: T1, fullName: 'Laura Pérez' },
        },
        {
          id: SUBJ2,
          name: 'Lengua',
          weeklyHours: 4,
          teacher: null,
        },
      ],
    });
  });

  it('curso de otra institución o inexistente → 404', async () => {
    const { svc } = service({ courses: [{ data: null, error: null }] });
    await expect(svc.courseAssignments(admin, COURSE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['teacher', teacherRole],
    ['guardian', guardian],
  ])('rol %s → 403', async (_n, member) => {
    const { svc } = service({});
    await expect(
      svc.courseAssignments(member, COURSE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
