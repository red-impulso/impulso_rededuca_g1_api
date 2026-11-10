import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { AttendanceService } from './attendance.service.js';
import type { AttendanceStatus } from './dto/save-attendance.dto.js';

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
        not: (...args: unknown[]) => (
          table.calls.push({ op: 'not', args }), q
        ),
        limit: (...args: unknown[]) => (
          table.calls.push({ op: 'limit', args }), q
        ),
        order: (...args: unknown[]) => (
          table.calls.push({ op: 'order', args }), q
        ),
        upsert: (...args: unknown[]) => (
          table.calls.push({ op: 'upsert', args }), q
        ),
        insert: (...args: unknown[]) => (
          table.calls.push({ op: 'insert', args }), q
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
  const events = { emit: vi.fn() };
  const svc = new AttendanceService({ admin: db } as any, events as any);
  return { svc, state, events };
}

const INST = '11111111-2222-3333-4444-555555555555';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const ST1 = 'cccccccc-0000-0000-0000-000000000001';
const ST2 = 'cccccccc-0000-0000-0000-000000000002';

const YESTERDAY = new Date(Date.now() - 86_400_000)
  .toISOString()
  .slice(0, 10);
const FUTURE = '2999-01-01';

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

const courseRow = { id: COURSE };
const teacherSubject = [{ id: 's1' }];

const roster = [
  { id: ST1, first_name: 'Ana', last_name: 'García' },
  { id: ST2, first_name: 'Luis', last_name: 'Pérez' },
];

const teacherBase = {
  courses: [{ data: courseRow, error: null }],
  subjects: [{ data: teacherSubject, error: null }],
};

describe('AttendanceService · getSheet', () => {
  it('devuelve alumnos del curso con su estado o null', async () => {
    const { svc } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
      attendance_records: [
        { data: [{ student_id: ST1, status: 'late' }], error: null },
      ],
    });
    await expect(
      svc.getSheet(teacher, COURSE, YESTERDAY),
    ).resolves.toEqual([
      {
        student: { id: ST1, firstName: 'Ana', lastName: 'García' },
        status: 'late',
      },
      {
        student: { id: ST2, firstName: 'Luis', lastName: 'Pérez' },
        status: null,
      },
    ]);
  });

  it('docente sin materias en el curso → 403', async () => {
    const { svc } = service({
      courses: [{ data: courseRow, error: null }],
      subjects: [{ data: [], error: null }],
    });
    await expect(
      svc.getSheet(teacher, COURSE, YESTERDAY),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('curso inexistente o de otra institución → 404', async () => {
    for (const member of [teacher, admin]) {
      const { svc } = service({
        courses: [{ data: null, error: null }],
      });
      await expect(
        svc.getSheet(member, COURSE, YESTERDAY),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('fecha futura → 400', async () => {
    const { svc } = service({ ...teacherBase });
    await expect(
      svc.getSheet(teacher, COURSE, FUTURE),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('formato de fecha inválido → 400', async () => {
    for (const date of ['15/10/2026', '2026-1-5', 'ayer', '2026-02-30']) {
      const { svc } = service({ ...teacherBase });
      await expect(
        svc.getSheet(teacher, COURSE, date),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('la planilla solo consulta alumnos activos (bajas excluidas)', async () => {
    const { svc, state } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
      attendance_records: [{ data: [], error: null }],
    });
    await svc.getSheet(teacher, COURSE, YESTERDAY);
    expect(state.students.calls).toContainEqual({
      op: 'eq',
      args: ['status', 'active'],
    });
  });
});

describe('AttendanceService · saveSheet', () => {
  const dto = (entries: { studentId: string; status: AttendanceStatus }[]) => ({
    courseId: COURSE,
    date: YESTERDAY,
    entries,
  });

  it('docente sin materias en el curso → 403 y no escribe nada', async () => {
    const { svc, state } = service({
      courses: [{ data: courseRow, error: null }],
      subjects: [{ data: [], error: null }],
    });
    await expect(
      svc.saveSheet(teacher, dto([{ studentId: ST1, status: 'present' }])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.attendance_records?.calls ?? []).toEqual([]);
  });

  it('fecha futura → 400 y no escribe nada', async () => {
    const { svc, state } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
    });
    await expect(
      svc.saveSheet(teacher, { ...dto([]), date: FUTURE, entries: [{ studentId: ST1, status: 'present' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.attendance_records?.calls ?? []).toEqual([]);
  });

  it('estado inválido → 400 y no guarda nada del lote', async () => {
    const { svc, state } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
    });
    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, status: 'present' },
          { studentId: ST2, status: 'excused' as any },
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (state.attendance_records?.calls ?? []).some((c) => c.op === 'upsert'),
    ).toBe(false);
  });

  it('estudiante ajeno al curso → 400 y no guarda nada', async () => {
    const { svc, state } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
    });
    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, status: 'present' },
          {
            studentId: 'cccccccc-0000-0000-0000-000000000099',
            status: 'absent',
          },
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (state.attendance_records?.calls ?? []).some((c) => c.op === 'upsert'),
    ).toBe(false);
  });

  it('upsert con recorded_by e institution_id, emite attendance.saved solo con ausentes', async () => {
    const { svc, state, events } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
      attendance_records: [
        {
          data: [
            { id: 'a1', student_id: ST1 },
            { id: 'a2', student_id: ST2 },
          ],
          error: null,
        },
      ],
    });

    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, status: 'absent' },
          { studentId: ST2, status: 'present' },
        ]),
      ),
    ).resolves.toEqual({ saved: 2 });

    const upserts = state.attendance_records.calls.filter(
      (c) => c.op === 'upsert',
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args[0]).toEqual([
      expect.objectContaining({
        institution_id: INST,
        student_id: ST1,
        course_id: COURSE,
        date: YESTERDAY,
        status: 'absent',
        recorded_by: 'uT',
      }),
      expect.objectContaining({
        institution_id: INST,
        student_id: ST2,
        course_id: COURSE,
        date: YESTERDAY,
        status: 'present',
        recorded_by: 'uT',
      }),
    ]);
    expect(upserts[0].args[1]).toEqual({ onConflict: 'student_id,date' });

    expect(events.emit).toHaveBeenCalledWith('attendance.saved', {
      institutionId: INST,
      courseId: COURSE,
      date: YESTERDAY,
      absentStudentIds: [ST1],
    });
  });

  it('sin ausentes → absentStudentIds vacío en el evento', async () => {
    const { svc, events } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
      attendance_records: [
        { data: [{ id: 'a1', student_id: ST1 }], error: null },
      ],
    });
    await svc.saveSheet(teacher, dto([{ studentId: ST1, status: 'late' }]));
    expect(events.emit).toHaveBeenCalledWith('attendance.saved', {
      institutionId: INST,
      courseId: COURSE,
      date: YESTERDAY,
      absentStudentIds: [],
    });
  });

  it('entries vacío → saved 0 sin writes ni evento', async () => {
    const { svc, state, events } = service({
      ...teacherBase,
      students: [{ data: roster, error: null }],
    });
    await expect(svc.saveSheet(teacher, dto([]))).resolves.toEqual({
      saved: 0,
    });
    expect(
      (state.attendance_records?.calls ?? []).some((c) => c.op === 'upsert'),
    ).toBe(false);
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('AttendanceService · getStudentAttendance', () => {
  const studentRow = { id: ST1, course_id: COURSE };

  const recordRows = [
    { date: '2026-10-20', status: 'present' },
    { date: '2026-10-19', status: 'absent' },
    { date: '2026-10-18', status: 'late' },
    { date: '2026-10-17', status: 'justified' },
  ];

  it('tutor no vinculado al alumno → 403 y no consulta registros', async () => {
    const { svc, state } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [{ data: null, error: null }],
    });
    await expect(
      svc.getStudentAttendance(guardian, ST1),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.attendance_records?.calls ?? []).toEqual([]);
  });

  it('tutor vinculado → registros y resumen', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [{ data: { id: 'l1' }, error: null }],
      attendance_records: [{ data: recordRows, error: null }],
    });
    await expect(
      svc.getStudentAttendance(guardian, ST1),
    ).resolves.toEqual({
      records: recordRows,
      summary: {
        present: 1,
        absent: 1,
        late: 1,
        justified: 1,
        percentage: 66.7,
      },
    });
  });

  it('docente sin materias en el curso del alumno → 403', async () => {
    const { svc, state } = service({
      students: [{ data: studentRow, error: null }],
      subjects: [{ data: [], error: null }],
    });
    await expect(
      svc.getStudentAttendance(teacher, ST1),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.attendance_records?.calls ?? []).toEqual([]);
  });

  it('docente con materia en el curso del alumno → devuelve registros', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      subjects: [{ data: teacherSubject, error: null }],
      attendance_records: [{ data: recordRows, error: null }],
    });
    const result = await svc.getStudentAttendance(teacher, ST1);
    expect(result.records).toEqual(recordRows);
  });

  it('alumno inexistente o de otra institución → 404', async () => {
    for (const member of [admin, guardian, teacher]) {
      const { svc } = service({
        students: [{ data: null, error: null }],
      });
      await expect(
        svc.getStudentAttendance(member, ST1),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('studentId inválido → 400', async () => {
    const { svc } = service({});
    await expect(
      svc.getStudentAttendance(admin, 'no-es-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin y director → acceso sin validación de vínculo ni materias', async () => {
    for (const member of [admin, director]) {
      const { svc, state } = service({
        students: [{ data: studentRow, error: null }],
        attendance_records: [{ data: recordRows, error: null }],
      });
      const result = await svc.getStudentAttendance(member, ST1);
      expect(result.records).toEqual(recordRows);
      expect(state.guardian_links?.calls ?? []).toEqual([]);
      expect(state.subjects?.calls ?? []).toEqual([]);
    }
  });

  it('sin registros → percentage null', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      attendance_records: [{ data: [], error: null }],
    });
    await expect(
      svc.getStudentAttendance(admin, ST1),
    ).resolves.toEqual({
      records: [],
      summary: {
        present: 0,
        absent: 0,
        late: 0,
        justified: 0,
        percentage: null,
      },
    });
  });

  it('solo presentes → 100%', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      attendance_records: [
        {
          data: [
            { date: '2026-10-20', status: 'present' },
            { date: '2026-10-19', status: 'present' },
          ],
          error: null,
        },
      ],
    });
    const { summary } = await svc.getStudentAttendance(admin, ST1);
    expect(summary.percentage).toBe(100);
  });

  it('solo ausentes → 0%', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      attendance_records: [
        {
          data: [
            { date: '2026-10-20', status: 'absent' },
            { date: '2026-10-19', status: 'absent' },
          ],
          error: null,
        },
      ],
    });
    const { summary } = await svc.getStudentAttendance(admin, ST1);
    expect(summary).toEqual({
      present: 0,
      absent: 2,
      late: 0,
      justified: 0,
      percentage: 0,
    });
  });

  it('llegadas tarde cuentan como asistidas en el porcentaje', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      attendance_records: [
        {
          data: [
            { date: '2026-10-20', status: 'late' },
            { date: '2026-10-19', status: 'absent' },
            { date: '2026-10-18', status: 'absent' },
          ],
          error: null,
        },
      ],
    });
    const { summary } = await svc.getStudentAttendance(admin, ST1);
    expect(summary).toEqual({
      present: 0,
      absent: 2,
      late: 1,
      justified: 0,
      percentage: 33.3,
    });
  });

  it('justified no entra al divisor ni al numerador del porcentaje', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      attendance_records: [
        {
          data: [
            { date: '2026-10-20', status: 'present' },
            { date: '2026-10-19', status: 'justified' },
            { date: '2026-10-18', status: 'justified' },
          ],
          error: null,
        },
      ],
    });
    const { summary } = await svc.getStudentAttendance(admin, ST1);
    expect(summary).toEqual({
      present: 1,
      absent: 0,
      late: 0,
      justified: 2,
      percentage: 100,
    });
  });

  it('solo justified → percentage null (divisor 0)', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      attendance_records: [
        { data: [{ date: '2026-10-20', status: 'justified' }], error: null },
      ],
    });
    const { summary } = await svc.getStudentAttendance(admin, ST1);
    expect(summary.percentage).toBeNull();
  });
});
