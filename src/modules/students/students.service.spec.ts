import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { StudentsService } from './students.service.js';

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
        range: (...args: unknown[]) => (
          table.calls.push({ op: 'range', args }), q
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
  const svc = new StudentsService({ admin: db } as any);
  return { svc, state, getUserById };
}

const INST = '11111111-2222-3333-4444-555555555555';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const COURSE2 = 'dddddddd-1111-2222-3333-444444444445';
const ST1 = 'cccccccc-0000-0000-0000-000000000001';
const ST2 = 'cccccccc-0000-0000-0000-000000000002';

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

const courseRef = {
  id: COURSE,
  year: 3,
  division: 'B',
  shift: 'morning',
  school_year: 2026,
};

const studentRow = {
  id: ST1,
  course_id: COURSE,
  first_name: 'Ana',
  last_name: 'García',
  dni: '40111222',
  file_number: 'L-123',
  birth_date: '2015-04-10',
  gender: 'Femenino',
  address: 'Calle Falsa 123',
  phone: '1144556677',
  email: 'ana@mail.com',
  status: 'active',
  enrollment_date: '2026-03-01',
  observation_academic: 'Buen desempeño',
  observation_institutional: null,
  created_at: '2026-03-01T10:00:00Z',
  updated_at: '2026-03-02T10:00:00Z',
};

const listRow = {
  id: ST1,
  first_name: 'Ana',
  last_name: 'García',
  dni: '40111222',
  file_number: 'L-123',
  status: 'active',
  updated_at: '2026-03-02T10:00:00Z',
  courses: courseRef,
};

const createDto = {
  firstName: 'Ana',
  lastName: 'García',
  dni: '40111222',
  fileNumber: 'L-123',
  courseId: COURSE,
};

describe('StudentsService · list', () => {
  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403 sin consultar la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.list(member, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.students?.calls ?? []).toEqual([]);
  });

  it('devuelve página, total y resumen con curso y tutor', async () => {
    const { svc } = service(
      {
        students: [{ data: [listRow], count: 1, error: null }],
        guardian_links: [
          {
            data: [{ student_id: ST1, guardian_membership_id: 'mG' }],
            error: null,
          },
        ],
        memberships: [
          {
            data: [
              {
                id: 'mG',
                user_id: 'uG',
                profiles: { full_name: 'María García', phone: '1133' },
              },
            ],
            error: null,
          },
        ],
      },
      { uG: 'maria@mail.com' },
    );

    await expect(svc.list(admin, {})).resolves.toEqual({
      data: [
        {
          id: ST1,
          firstName: 'Ana',
          lastName: 'García',
          dni: '40111222',
          fileNumber: 'L-123',
          status: 'active',
          course: {
            id: COURSE,
            year: 3,
            division: 'B',
            shift: 'morning',
            schoolYear: 2026,
          },
          guardian: {
            id: 'mG',
            fullName: 'María García',
            phone: '1133',
            email: 'maria@mail.com',
          },
          updatedAt: '2026-03-02T10:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
  });

  it('filtra por institución y aplica paginación por defecto', async () => {
    const { svc, state } = service({
      students: [{ data: [], count: 0, error: null }],
    });
    await svc.list(director, {});
    const calls = state.students.calls;
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    expect(calls).toContainEqual({ op: 'range', args: [0, 24] });
    expect(calls).toContainEqual({
      op: 'select',
      args: [expect.any(String), { count: 'exact' }],
    });
  });

  it('filtra por courseId y status', async () => {
    const { svc, state } = service({
      students: [{ data: [], count: 0, error: null }],
    });
    await svc.list(admin, { courseId: COURSE, status: 'draft', page: 2 });
    const calls = state.students.calls;
    expect(calls).toContainEqual({ op: 'eq', args: ['course_id', COURSE] });
    expect(calls).toContainEqual({ op: 'eq', args: ['status', 'draft'] });
    expect(calls).toContainEqual({ op: 'range', args: [25, 49] });
  });

  it('q busca insensible a mayúsculas en nombre, apellido, dni y legajo', async () => {
    const { svc, state } = service({
      students: [{ data: [listRow], count: 1, error: null }],
    });
    await svc.list(admin, { q: 'gar' });
    const orCall = state.students.calls.find((c) => c.op === 'or');
    expect(orCall?.args[0]).toBe(
      'first_name.ilike.%gar%,last_name.ilike.%gar%,dni.ilike.%gar%,file_number.ilike.%gar%',
    );
  });

  it.each([
    ['status inválido', { status: 'egresado' }],
    ['courseId inválido', { courseId: 'no-uuid' }],
    ['page < 1', { page: 0 }],
    ['limit > 100', { limit: 500 }],
  ])('parámetro inválido: %s → 400', async (_n, params) => {
    const { svc } = service({});
    await expect(svc.list(admin, params)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('StudentsService · profile', () => {
  const tablesForProfile = (overrides: Record<string, unknown[]> = {}) => ({
    students: [
      {
        data: { ...studentRow, courses: courseRef },
        error: null,
      },
    ],
    grades: [
      {
        data: [
          { subject_id: 's-mat', value: 8 },
          { subject_id: 's-mat', value: 9 },
          { subject_id: 's-len', value: 4 },
        ],
        error: null,
      },
    ],
    attendance_records: [
      {
        data: [
          { status: 'present' },
          { status: 'present' },
          { status: 'absent' },
          { status: 'late' },
          { status: 'justified' },
        ],
        error: null,
      },
    ],
    guardian_links: [
      {
        data: [{ student_id: ST1, guardian_membership_id: 'mG' }],
        error: null,
      },
    ],
    memberships: [
      {
        data: [
          {
            id: 'mG',
            user_id: 'uG',
            profiles: { full_name: 'María García', phone: '1133' },
          },
        ],
        error: null,
      },
    ],
    ...overrides,
  });

  it('arma la ficha completa con resúmenes calculados', async () => {
    const { svc } = service(tablesForProfile(), { uG: 'maria@mail.com' });
    await expect(svc.profile(admin, ST1)).resolves.toEqual({
      personal: {
        id: ST1,
        firstName: 'Ana',
        lastName: 'García',
        dni: '40111222',
        fileNumber: 'L-123',
        birthDate: '2015-04-10',
        gender: 'Femenino',
        address: 'Calle Falsa 123',
        phone: '1144556677',
        email: 'ana@mail.com',
      },
      academic: {
        course: {
          id: COURSE,
          year: 3,
          division: 'B',
          shift: 'morning',
          schoolYear: 2026,
        },
        enrollmentDate: '2026-03-01',
        status: 'active',
      },
      academicSummary: {
        averageGrade: 7,
        approvedSubjects: 1,
        pendingSubjects: 1,
      },
      attendanceSummary: {
        percentage: 75,
        justified: 1,
        unjustified: 1,
        late: 1,
      },
      guardians: [
        {
          id: 'mG',
          fullName: 'María García',
          phone: '1133',
          email: 'maria@mail.com',
        },
      ],
      observations: {
        academic: 'Buen desempeño',
        institutional: null,
      },
    });
  });

  it('sin notas ni asistencias → resúmenes vacíos con nulls', async () => {
    const { svc } = service(
      tablesForProfile({
        grades: [{ data: [], error: null }],
        attendance_records: [{ data: [], error: null }],
        guardian_links: [{ data: [], error: null }],
      }),
    );
    const profile = await svc.profile(admin, ST1);
    expect(profile.academicSummary).toEqual({
      averageGrade: null,
      approvedSubjects: 0,
      pendingSubjects: 0,
    });
    expect(profile.attendanceSummary).toEqual({
      percentage: null,
      justified: 0,
      unjustified: 0,
      late: 0,
    });
    expect(profile.guardians).toEqual([]);
  });

  it('alumno inexistente o de otra institución → 404', async () => {
    const { svc } = service({
      students: [{ data: null, error: null }],
    });
    await expect(svc.profile(admin, ST1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('id inválido → 400', async () => {
    const { svc } = service({});
    await expect(svc.profile(admin, 'no-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('StudentsService · create', () => {
  const createdRow = { ...studentRow };

  it('crea el alumno con institution_id y devuelve el registro', async () => {
    const { svc, state } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      students: [
        { data: [], error: null },
        { data: createdRow, error: null },
      ],
    });
    await expect(svc.create(admin, createDto)).resolves.toMatchObject({
      id: ST1,
      firstName: 'Ana',
      lastName: 'García',
      dni: '40111222',
      status: 'active',
    });
    const insert = state.students.calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toMatchObject({
      institution_id: INST,
      course_id: COURSE,
      first_name: 'Ana',
      last_name: 'García',
      dni: '40111222',
      status: 'active',
    });
  });

  it('DNI duplicado en la misma institución → 409 y no inserta', async () => {
    const { svc, state } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      students: [{ data: [{ id: ST2 }], error: null }],
    });
    await expect(svc.create(admin, createDto)).rejects.toThrow(
      'Ya existe un alumno con ese DNI en esta institución',
    );
    expect(state.students.calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('violación de unicidad de Postgres (23505) → 409', async () => {
    const { svc } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      students: [
        { data: [], error: null },
        { data: null, error: { code: '23505' } },
      ],
    });
    await expect(svc.create(admin, createDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('curso de otra institución → 404 y no inserta', async () => {
    const { svc, state } = service({
      courses: [{ data: null, error: null }],
    });
    await expect(svc.create(admin, createDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(state.students?.calls ?? []).toEqual([]);
  });

  it('alta como borrador con status draft', async () => {
    const draft = { ...createdRow, status: 'draft' };
    const { svc } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      students: [
        { data: [], error: null },
        { data: draft, error: null },
      ],
    });
    await expect(
      svc.create(admin, { ...createDto, status: 'draft' }),
    ).resolves.toMatchObject({ status: 'draft' });
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403 sin consultar la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.create(member, createDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.students?.calls ?? []).toEqual([]);
    expect(state.courses?.calls ?? []).toEqual([]);
  });

  it.each([
    ['sin firstName', { ...createDto, firstName: '  ' }],
    ['courseId inválido', { ...createDto, courseId: 'no-uuid' }],
    ['gender inválido', { ...createDto, gender: 'X' as any }],
    ['status inválido', { ...createDto, status: 'inactive' as any }],
    ['birthDate inválida', { ...createDto, birthDate: '10/04/2015' }],
  ])('body inválido: %s → 400 sin escribir', async (_n, dto) => {
    const { svc, state } = service({});
    await expect(svc.create(admin, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.students?.calls ?? []).toEqual([]);
  });
});

describe('StudentsService · update', () => {
  it('cambia de curso: verifica el curso y actualiza course_id', async () => {
    const { svc, state } = service({
      students: [
        { data: { ...studentRow, courses: courseRef }, error: null },
        { data: { ...studentRow, course_id: COURSE2 }, error: null },
      ],
      courses: [{ data: { id: COURSE2 }, error: null }],
    });
    await expect(
      svc.update(admin, ST1, { courseId: COURSE2 }),
    ).resolves.toMatchObject({ courseId: COURSE2 });
    expect(state.courses.calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    const upd = state.students.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toMatchObject({ course_id: COURSE2 });
  });

  it('edita datos personales y observaciones', async () => {
    const { svc, state } = service({
      students: [
        { data: { ...studentRow, courses: courseRef }, error: null },
        { data: studentRow, error: null },
      ],
    });
    await svc.update(admin, ST1, {
      phone: '119999',
      observationInstitutional: 'Acuerdo con familia',
    });
    const upd = state.students.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toMatchObject({
      phone: '119999',
      observation_institutional: 'Acuerdo con familia',
    });
  });

  it('DNI que colisiona con otro alumno de la institución → 409', async () => {
    const { svc, state } = service({
      students: [
        { data: { ...studentRow, courses: courseRef }, error: null },
        { data: [{ id: ST2 }], error: null },
      ],
    });
    await expect(
      svc.update(admin, ST1, { dni: '30999888' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.students.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('mismo DNI sin cambio → no cuenta como duplicado', async () => {
    const { svc } = service({
      students: [
        { data: { ...studentRow, courses: courseRef }, error: null },
        { data: studentRow, error: null },
      ],
    });
    await expect(
      svc.update(admin, ST1, { dni: '40111222' }),
    ).resolves.toMatchObject({ dni: '40111222' });
  });

  it('alumno inexistente o de otra institución → 404', async () => {
    const { svc } = service({
      students: [{ data: null, error: null }],
    });
    await expect(
      svc.update(admin, ST1, { phone: '1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('id inválido → 400', async () => {
    const { svc } = service({});
    await expect(
      svc.update(admin, 'no-uuid', { phone: '1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dto vacío → 400', async () => {
    const { svc } = service({
      students: [{ data: { ...studentRow, courses: courseRef }, error: null }],
    });
    await expect(svc.update(admin, ST1, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403', async (_n, member) => {
    const { svc } = service({});
    await expect(
      svc.update(member, ST1, { phone: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StudentsService · remove', () => {
  it('baja lógica: marca status inactive y NUNCA borra la fila', async () => {
    const { svc, state } = service({
      students: [
        { data: { ...studentRow, courses: courseRef }, error: null },
        { data: null, error: null },
      ],
    });
    await expect(svc.remove(admin, ST1)).resolves.toBeUndefined();
    const upd = state.students.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toMatchObject({ status: 'inactive' });
    expect(state.students.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('alumno inexistente o de otra institución → 404 y no escribe', async () => {
    const { svc, state } = service({
      students: [{ data: null, error: null }],
    });
    await expect(svc.remove(admin, ST1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(state.students.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('id inválido → 400', async () => {
    const { svc } = service({});
    await expect(svc.remove(admin, 'no-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403 y no da de baja', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.remove(member, ST1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.students?.calls ?? []).toEqual([]);
  });
});
