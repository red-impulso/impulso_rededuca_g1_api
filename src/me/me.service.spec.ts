import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MeService } from './me.service.js';

function chain(result: unknown) {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve(result),
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return q;
}

function service(tables: Record<string, unknown>) {
  return new MeService({
    admin: { from: (t: string) => chain(tables[t]) },
  } as any);
}

describe('MeService', () => {
  it('devuelve perfil y membresías', async () => {
    const svc = service({
      profiles: {
        data: { id: 'u1', full_name: 'Ana Pérez', phone: '+54 11 1234' },
        error: null,
      },
      memberships: {
        data: [
          {
            id: 'm1',
            institution_id: 'i1',
            role: 'teacher',
            institutions: { name: 'Escuela 1' },
          },
        ],
        error: null,
      },
    });
    await expect(svc.getMe('u1')).resolves.toEqual({
      profile: { id: 'u1', fullName: 'Ana Pérez', phone: '+54 11 1234' },
      memberships: [
        {
          id: 'm1',
          institutionId: 'i1',
          institutionName: 'Escuela 1',
          role: 'teacher',
        },
      ],
    });
  });

  it('sin perfil → 404', async () => {
    const svc = service({
      profiles: { data: null, error: null },
      memberships: { data: [], error: null },
    });
    await expect(svc.getMe('u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

const teacherMembership = {
  id: 'mT',
  userId: 'u1',
  institutionId: 'i1',
  role: 'teacher',
} as const;

const guardianMembership = {
  id: 'mG',
  userId: 'u2',
  institutionId: 'i1',
  role: 'guardian',
} as const;

describe('MeService · getMySubjects', () => {
  it('devuelve las materias del docente con su curso', async () => {
    const svc = service({
      subjects: {
        data: [
          {
            id: 's1',
            name: 'Matemática',
            courses: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
          },
          {
            id: 's2',
            name: 'Física',
            courses: { id: 'c2', year: 6, division: 'B', shift: 'afternoon' },
          },
        ],
        error: null,
      },
    });
    await expect(svc.getMySubjects(teacherMembership)).resolves.toEqual([
      {
        id: 's1',
        name: 'Matemática',
        course: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
      },
      {
        id: 's2',
        name: 'Física',
        course: { id: 'c2', year: 6, division: 'B', shift: 'afternoon' },
      },
    ]);
  });

  it('sin materias → lista vacía', async () => {
    const svc = service({ subjects: { data: [], error: null } });
    await expect(svc.getMySubjects(teacherMembership)).resolves.toEqual([]);
  });
});

describe('MeService · getMyCourses', () => {
  it('deduplica los cursos donde enseña', async () => {
    const svc = service({
      subjects: {
        data: [
          {
            id: 's1',
            name: 'Matemática',
            courses: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
          },
          {
            id: 's2',
            name: 'Física',
            courses: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
          },
          {
            id: 's3',
            name: 'Química',
            courses: { id: 'c2', year: 6, division: 'B', shift: 'afternoon' },
          },
        ],
        error: null,
      },
    });
    await expect(svc.getMyCourses(teacherMembership)).resolves.toEqual([
      { id: 'c1', year: 5, division: 'A', shift: 'morning' },
      { id: 'c2', year: 6, division: 'B', shift: 'afternoon' },
    ]);
  });
});

describe('MeService · getMyStudents', () => {
  it('devuelve los hijos vinculados vía guardian_links', async () => {
    const svc = service({
      guardian_links: {
        data: [
          {
            students: {
              id: 'st1',
              first_name: 'Juana',
              last_name: 'Pérez',
              courses: { id: 'c1', year: 3, division: 'B' },
            },
          },
          {
            students: {
              id: 'st2',
              first_name: 'Luis',
              last_name: 'Pérez',
              courses: { id: 'c2', year: 1, division: 'A' },
            },
          },
        ],
        error: null,
      },
    });
    await expect(svc.getMyStudents(guardianMembership)).resolves.toEqual([
      {
        id: 'st1',
        firstName: 'Juana',
        lastName: 'Pérez',
        course: { id: 'c1', year: 3, division: 'B' },
      },
      {
        id: 'st2',
        firstName: 'Luis',
        lastName: 'Pérez',
        course: { id: 'c2', year: 1, division: 'A' },
      },
    ]);
  });

  it('estudiante sin curso → course null', async () => {
    const svc = service({
      guardian_links: {
        data: [
          {
            students: {
              id: 'st1',
              first_name: 'Juana',
              last_name: 'Pérez',
              courses: null,
            },
          },
        ],
        error: null,
      },
    });
    await expect(svc.getMyStudents(guardianMembership)).resolves.toEqual([
      { id: 'st1', firstName: 'Juana', lastName: 'Pérez', course: null },
    ]);
  });
});
