import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { SubjectsService } from './subjects.service.js';

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
  const svc = new SubjectsService({ admin: db } as any);
  return { svc, state };
}

const INST = '11111111-2222-3333-4444-555555555555';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const SUBJECT = 'eeeeeeee-1111-2222-3333-444444444444';
const TEACHER_M = 'ffffffff-1111-2222-3333-444444444444';

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

const courseEmbedded = {
  id: COURSE,
  name: '1° A',
  year: 1,
  division: 'A',
  shift: 'morning',
  school_year: 2026,
  institution_id: INST,
};

const subjectRow = {
  id: SUBJECT,
  name: 'Matemática',
  course_id: COURSE,
  teacher_membership_id: TEACHER_M,
  courses: courseEmbedded,
};

const expectedItem = {
  id: SUBJECT,
  name: 'Matemática',
  course: {
    id: COURSE,
    name: '1° A',
    year: 1,
    division: 'A',
    shift: 'morning',
    schoolYear: 2026,
  },
  teacher: { id: TEACHER_M, fullName: 'Laura Gómez' },
  weeklyHours: 4,
  description: null,
  status: 'active',
  studentsCount: 0,
  updatedAt: null,
};

const teacherMembership = {
  id: TEACHER_M,
  user_id: 'uT1',
  role: 'teacher',
};

const teacherProfile = { id: 'uT1', full_name: 'Laura Gómez' };

const createDto = {
  courseId: COURSE,
  name: 'Matemática',
  teacherMembershipId: TEACHER_M,
};

describe('SubjectsService · list', () => {
  it('devuelve materias con curso y docente', async () => {
    const { svc } = service({
      subjects: [{ data: [subjectRow], error: null }],
      memberships: [{ data: [teacherMembership], error: null }],
      profiles: [{ data: [teacherProfile], error: null }],
    });
    await expect(svc.list(admin)).resolves.toEqual([expectedItem]);
  });

  it('admin y director → acceso', async () => {
    for (const member of [admin, director]) {
      const { svc } = service({
        subjects: [{ data: [subjectRow], error: null }],
        memberships: [{ data: [teacherMembership], error: null }],
        profiles: [{ data: [teacherProfile], error: null }],
      });
      await expect(svc.list(member)).resolves.toHaveLength(1);
    }
  });

  it('teacher o guardian → 403 sin consultar la base', async () => {
    for (const member of [teacher, guardian]) {
      const { svc, state } = service({});
      await expect(svc.list(member)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(state.subjects?.calls ?? []).toEqual([]);
    }
  });

  it('filtra por courseId validando que el curso sea de la institución', async () => {
    const { svc, state } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      subjects: [{ data: [subjectRow], error: null }],
      memberships: [{ data: [teacherMembership], error: null }],
      profiles: [{ data: [teacherProfile], error: null }],
    });
    await expect(svc.list(admin, COURSE)).resolves.toHaveLength(1);
    expect(state.subjects.calls).toContainEqual({
      op: 'eq',
      args: ['course_id', COURSE],
    });
  });

  it('courseId inválido → 400', async () => {
    const { svc } = service({});
    await expect(svc.list(admin, 'no-es-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('courseId de otra institución → 404', async () => {
    const { svc } = service({
      courses: [{ data: null, error: null }],
    });
    await expect(svc.list(admin, COURSE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('materia sin docente → teacher null', async () => {
    const { svc } = service({
      subjects: [
        {
          data: [{ ...subjectRow, teacher_membership_id: null }],
          error: null,
        },
      ],
    });
    const [item] = await svc.list(admin);
    expect(item.teacher).toBeNull();
  });
});

describe('SubjectsService · create', () => {
  it('crea la materia con docente asignado', async () => {
    const { svc, state } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      memberships: [{ data: teacherMembership, error: null }],
      profiles: [{ data: teacherProfile, error: null }],
      subjects: [{ data: subjectRow, error: null }],
    });
    await expect(svc.create(admin, createDto)).resolves.toEqual(expectedItem);
    expect(
      state.subjects.calls.find((c) => c.op === 'insert')?.args[0],
    ).toEqual({
      course_id: COURSE,
      name: 'Matemática',
      teacher_membership_id: TEACHER_M,
      description: null,
    });
  });

  it('sin docente → teacher_membership_id null', async () => {
    const { svc, state } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      subjects: [
        {
          data: { ...subjectRow, teacher_membership_id: null },
          error: null,
        },
      ],
    });
    const { teacherMembershipId: _t, ...dto } = createDto;
    const item = await svc.create(admin, dto);
    expect(item.teacher).toBeNull();
    expect(
      state.subjects.calls.find((c) => c.op === 'insert')?.args[0],
    ).toMatchObject({ teacher_membership_id: null });
  });

  it('curso de otra institución → 404 y no inserta', async () => {
    const { svc, state } = service({
      courses: [{ data: null, error: null }],
    });
    await expect(svc.create(admin, createDto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(state.subjects?.calls ?? []).toEqual([]);
  });

  it('teacherMembershipId inexistente en la institución → 400', async () => {
    const { svc } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      memberships: [{ data: null, error: null }],
    });
    await expect(svc.create(admin, createDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('teacherMembershipId con rol que no es teacher → 400', async () => {
    const { svc } = service({
      courses: [{ data: { id: COURSE }, error: null }],
      memberships: [
        { data: { ...teacherMembership, role: 'guardian' }, error: null },
      ],
    });
    await expect(svc.create(admin, createDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403 sin consultar la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.create(member, createDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.subjects?.calls ?? []).toEqual([]);
    expect(state.courses?.calls ?? []).toEqual([]);
  });

  it.each([
    ['courseId inválido', { ...createDto, courseId: 'x' }],
    ['name vacío', { ...createDto, name: '  ' }],
  ])('body inválido: %s → 400', async (_n, dto) => {
    const { svc } = service({});
    await expect(svc.create(admin, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SubjectsService · update', () => {
  const subjectRef = {
    id: SUBJECT,
    course_id: COURSE,
    courses: { id: COURSE },
  };

  it('renombra la materia', async () => {
    const { svc, state } = service({
      subjects: [
        { data: subjectRef, error: null },
        { data: { ...subjectRow, name: 'Lengua' }, error: null },
      ],
      memberships: [{ data: [teacherMembership], error: null }],
      profiles: [{ data: [teacherProfile], error: null }],
    });
    const item = await svc.update(admin, SUBJECT, { name: 'Lengua' });
    expect(item.name).toBe('Lengua');
    expect(
      state.subjects.calls.find((c) => c.op === 'update')?.args[0],
    ).toMatchObject({ name: 'Lengua' });
  });

  it('reasigna el docente', async () => {
    const { svc, state } = service({
      subjects: [
        { data: subjectRef, error: null },
        { data: subjectRow, error: null },
      ],
      memberships: [{ data: teacherMembership, error: null }],
      profiles: [{ data: teacherProfile, error: null }],
    });
    const item = await svc.update(admin, SUBJECT, {
      teacherMembershipId: TEACHER_M,
    });
    expect(item.teacher).toEqual({ id: TEACHER_M, fullName: 'Laura Gómez' });
    expect(
      state.subjects.calls.find((c) => c.op === 'update')?.args[0],
    ).toMatchObject({ teacher_membership_id: TEACHER_M });
  });

  it('teacherMembershipId null → desasigna al docente', async () => {
    const { svc, state } = service({
      subjects: [
        { data: subjectRef, error: null },
        { data: { ...subjectRow, teacher_membership_id: null }, error: null },
      ],
    });
    const item = await svc.update(admin, SUBJECT, {
      teacherMembershipId: null,
    });
    expect(item.teacher).toBeNull();
    expect(
      state.subjects.calls.find((c) => c.op === 'update')?.args[0],
    ).toMatchObject({ teacher_membership_id: null });
  });

  it('materia inexistente o de otra institución → 404', async () => {
    const { svc } = service({
      subjects: [{ data: null, error: null }],
    });
    await expect(
      svc.update(admin, SUBJECT, { name: 'Lengua' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dto vacío → 400', async () => {
    const { svc } = service({
      subjects: [{ data: subjectRef, error: null }],
    });
    await expect(svc.update(admin, SUBJECT, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403', async (_n, member) => {
    const { svc } = service({});
    await expect(
      svc.update(member, SUBJECT, { name: 'Lengua' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SubjectsService · remove', () => {
  const subjectRef = {
    id: SUBJECT,
    course_id: COURSE,
    courses: { id: COURSE },
  };

  it('elimina la materia (204)', async () => {
    const { svc, state } = service({
      subjects: [
        { data: subjectRef, error: null },
        { data: null, error: null },
      ],
    });
    await expect(svc.remove(admin, SUBJECT)).resolves.toBeUndefined();
    expect(state.subjects.calls.some((c) => c.op === 'delete')).toBe(true);
  });

  it('admin y director → pueden eliminar', async () => {
    for (const member of [admin, director]) {
      const { svc } = service({
        subjects: [
          { data: subjectRef, error: null },
          { data: null, error: null },
        ],
      });
      await expect(svc.remove(member, SUBJECT)).resolves.toBeUndefined();
    }
  });

  it('materia inexistente o de otra institución → 404', async () => {
    const { svc, state } = service({
      subjects: [{ data: null, error: null }],
    });
    await expect(svc.remove(admin, SUBJECT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(state.subjects.calls.some((c) => c.op === 'delete')).toBe(false);
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
    await expect(svc.remove(member, SUBJECT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.subjects?.calls ?? []).toEqual([]);
  });
});

describe('SubjectsService · detail (GET /subjects/:id)', () => {
  it('devuelve la materia con todos los campos del contrato', async () => {
    const { svc } = service({
      subjects: [
        {
          data: {
            ...subjectRow,
            weekly_hours: 8,
            description: 'Área troncal',
            status: 'active',
            updated_at: '2026-11-11T10:00:00Z',
          },
          error: null,
        },
      ],
      memberships: [{ data: [teacherMembership], error: null }],
      profiles: [{ data: [teacherProfile], error: null }],
      students: [
        { data: [{ course_id: COURSE }, { course_id: COURSE }], error: null },
      ],
    });
    await expect(svc.detail(admin, SUBJECT)).resolves.toEqual({
      ...expectedItem,
      weeklyHours: 8,
      description: 'Área troncal',
      studentsCount: 2,
      updatedAt: '2026-11-11T10:00:00Z',
    });
  });

  it('materia inexistente → 404', async () => {
    const { svc } = service({
      subjects: [{ data: null, error: null }],
    });
    await expect(svc.detail(admin, SUBJECT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
