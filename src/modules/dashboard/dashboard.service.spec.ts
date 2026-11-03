import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { DashboardService } from './dashboard.service.js';

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
        gte: (...args: unknown[]) => (
          table.calls.push({ op: 'gte', args }), q
        ),
        in: (...args: unknown[]) => (
          table.calls.push({ op: 'in', args }), q
        ),
        not: (...args: unknown[]) => (
          table.calls.push({ op: 'not', args }), q
        ),
        limit: (...args: unknown[]) => (
          table.calls.push({ op: 'limit', args }), q
        ),
        order: (...args: unknown[]) => (
          table.calls.push({ op: 'order', args }), q
        ),
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
  const svc = new DashboardService({ admin: db } as any);
  return { svc, state };
}

const INST = '11111111-2222-3333-4444-555555555555';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const COURSE2 = 'dddddddd-1111-2222-3333-444444444445';
const SUB1 = 'eeeeeeee-0000-0000-0000-000000000001';
const SUB2 = 'eeeeeeee-0000-0000-0000-000000000002';
const ST1 = 'cccccccc-0000-0000-0000-000000000001';
const ST2 = 'cccccccc-0000-0000-0000-000000000002';

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

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

const st1 = { id: ST1, first_name: 'Ana', last_name: 'García' };
const st2 = { id: ST2, first_name: 'Luis', last_name: 'Pérez' };
const course1 = { id: COURSE, name: '1° A' };
const course2 = { id: COURSE2, name: '2° B' };

const empty = {
  students: [{ count: 0, data: null, error: null }],
  courses: [{ count: 0, data: null, error: null }],
  memberships: [{ count: 0, data: null, error: null }],
  attendance_records: [
    { data: [], error: null },
    { data: [], error: null },
  ],
  subjects: [{ data: [], error: null }],
  grades: [{ data: [], error: null }],
};

describe('DashboardService · getSummary', () => {
  it('teacher o guardian → 403 sin consultar la base', async () => {
    for (const member of [teacher, guardian]) {
      const { svc, state } = service({});
      await expect(svc.getSummary(member)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(state.students?.calls ?? []).toEqual([]);
      expect(state.attendance_records?.calls ?? []).toEqual([]);
    }
  });

  it('admin y director → acceso permitido', async () => {
    for (const member of [admin, director]) {
      const { svc } = service({ ...empty });
      await expect(svc.getSummary(member)).resolves.toBeDefined();
    }
  });

  it('institución vacía → conteos en 0, promedios null y listas vacías', async () => {
    const { svc } = service({ ...empty });
    await expect(svc.getSummary(admin)).resolves.toEqual({
      students: 0,
      courses: 0,
      teachers: 0,
      attendanceAverage: null,
      lowAttendance: [],
      gradeAverages: [],
    });
  });

  it('conteos de students, courses y teachers (memberships con role teacher)', async () => {
    const { svc, state } = service({
      ...empty,
      students: [{ count: 42, data: null, error: null }],
      courses: [{ count: 6, data: null, error: null }],
      memberships: [{ count: 9, data: null, error: null }],
    });
    const result = await svc.getSummary(director);
    expect(result.students).toBe(42);
    expect(result.courses).toBe(6);
    expect(result.teachers).toBe(9);
    expect(state.memberships.calls).toContainEqual({
      op: 'eq',
      args: ['role', 'teacher'],
    });
  });

  it('attendanceAverage global sin justified', async () => {
    const { svc } = service({
      ...empty,
      attendance_records: [
        {
          data: [
            { status: 'present' },
            { status: 'present' },
            { status: 'late' },
            { status: 'absent' },
          ],
          error: null,
        },
        { data: [], error: null },
      ],
    });
    const { attendanceAverage } = await svc.getSummary(admin);
    // (2 present + 1 late) / 4 evaluables = 75.0
    expect(attendanceAverage).toBe(75);
  });

  it('attendanceAverage ignora justified en numerador y divisor', async () => {
    const { svc } = service({
      ...empty,
      attendance_records: [
        {
          data: [
            { status: 'present' },
            { status: 'justified' },
            { status: 'justified' },
            { status: 'absent' },
          ],
          error: null,
        },
        { data: [], error: null },
      ],
    });
    const { attendanceAverage } = await svc.getSummary(admin);
    // 1 / 2 = 50.0
    expect(attendanceAverage).toBe(50);
  });

  it('attendanceAverage null cuando solo hay justified', async () => {
    const { svc } = service({
      ...empty,
      attendance_records: [
        {
          data: [{ status: 'justified' }, { status: 'justified' }],
          error: null,
        },
        { data: [], error: null },
      ],
    });
    const { attendanceAverage } = await svc.getSummary(admin);
    expect(attendanceAverage).toBeNull();
  });

  it('lowAttendance detecta alumnos con < 85% en los últimos 30 días', async () => {
    const { svc, state } = service({
      ...empty,
      attendance_records: [
        { data: [], error: null },
        {
          data: [
            // Ana: 3 present + 1 absent + 1 justified → 75%
            { status: 'present', student_id: ST1, students: st1, courses: course1 },
            { status: 'present', student_id: ST1, students: st1, courses: course1 },
            { status: 'present', student_id: ST1, students: st1, courses: course1 },
            { status: 'absent', student_id: ST1, students: st1, courses: course1 },
            { status: 'justified', student_id: ST1, students: st1, courses: course1 },
            // Luis: 9 present + 1 absent → 90% (no entra)
            ...Array.from({ length: 9 }, () => ({
              status: 'present',
              student_id: ST2,
              students: st2,
              courses: course2,
            })),
            { status: 'absent', student_id: ST2, students: st2, courses: course2 },
          ],
          error: null,
        },
      ],
    });
    const result = await svc.getSummary(admin);
    expect(result.lowAttendance).toEqual([
      {
        student: { id: ST1, firstName: 'Ana', lastName: 'García' },
        course: { id: COURSE, name: '1° A' },
        percentage: 75,
      },
    ]);
    const gte = state.attendance_records.calls.find((c) => c.op === 'gte');
    expect(gte?.args[0]).toBe('date');
    expect(gte?.args[1]).toBe(daysAgo(30));
  });

  it('lowAttendance ordena por percentage ascendente (peor asistencia primero)', async () => {
    const { svc } = service({
      ...empty,
      attendance_records: [
        { data: [], error: null },
        {
          data: [
            // Ana: 1 present + 1 absent → 50%
            { status: 'present', student_id: ST1, students: st1, courses: course1 },
            { status: 'absent', student_id: ST1, students: st1, courses: course1 },
            // Luis: 4 absent + 1 late → 20%
            { status: 'late', student_id: ST2, students: st2, courses: course2 },
            ...Array.from({ length: 4 }, () => ({
              status: 'absent',
              student_id: ST2,
              students: st2,
              courses: course2,
            })),
          ],
          error: null,
        },
      ],
    });
    const result = await svc.getSummary(admin);
    expect(result.lowAttendance.map((r) => r.percentage)).toEqual([20, 50]);
    expect(result.lowAttendance[0].student.id).toBe(ST2);
  });

  it('lowAttendance excluye alumnos solo con justified (percentage null)', async () => {
    const { svc } = service({
      ...empty,
      attendance_records: [
        { data: [], error: null },
        {
          data: [
            { status: 'justified', student_id: ST1, students: st1, courses: course1 },
          ],
          error: null,
        },
      ],
    });
    const result = await svc.getSummary(admin);
    expect(result.lowAttendance).toEqual([]);
  });

  it('gradeAverages: promedio por materia y curso, null sin notas', async () => {
    const { svc } = service({
      ...empty,
      subjects: [
        {
          data: [
            { id: SUB1, name: 'Matemática', courses: course1 },
            { id: SUB2, name: 'Lengua', courses: course2 },
          ],
          error: null,
        },
      ],
      grades: [
        {
          data: [
            { subject_id: SUB1, value: 8 },
            { subject_id: SUB1, value: 7.3 },
            { subject_id: SUB1, value: 7.65 },
          ],
          error: null,
        },
      ],
    });
    const result = await svc.getSummary(admin);
    // (8 + 7.3 + 7.65) / 3 = 7.65
    expect(result.gradeAverages).toEqual([
      {
        subject: { id: SUB2, name: 'Lengua' },
        course: { id: COURSE2, name: '2° B' },
        average: null,
      },
      {
        subject: { id: SUB1, name: 'Matemática' },
        course: { id: COURSE, name: '1° A' },
        average: 7.65,
      },
    ]);
  });

  it('gradeAverages redondea a 2 decimales', async () => {
    const { svc } = service({
      ...empty,
      subjects: [
        {
          data: [{ id: SUB1, name: 'Matemática', courses: course1 }],
          error: null,
        },
      ],
      grades: [
        {
          data: [
            { subject_id: SUB1, value: 7 },
            { subject_id: SUB1, value: 8 },
            { subject_id: SUB1, value: 7 },
          ],
          error: null,
        },
      ],
    });
    const result = await svc.getSummary(admin);
    // 22 / 3 = 7.3333... → 7.33
    expect(result.gradeAverages[0].average).toBe(7.33);
  });
});
