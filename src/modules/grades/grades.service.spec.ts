import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { GradesService } from './grades.service.js';

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
  const svc = new GradesService({ admin: db } as any, events as any);
  return { svc, state, events };
}

const INST = '11111111-2222-3333-4444-555555555555';
const SUBJECT = 'aaaaaaaa-1111-2222-3333-444444444444';
const PERIOD = 'bbbbbbbb-1111-2222-3333-444444444444';
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

const subjectRow = (teacherMembershipId = 'mT') => ({
  id: SUBJECT,
  course_id: 'c1',
  teacher_membership_id: teacherMembershipId,
  courses: { id: 'c1' },
});

const roster = [
  { id: ST1, first_name: 'Ana', last_name: 'García' },
  { id: ST2, first_name: 'Luis', last_name: 'Pérez' },
];

const baseTables = {
  subjects: [{ data: subjectRow(), error: null }],
  grading_periods: [{ data: { id: PERIOD }, error: null }],
};

describe('GradesService · listPeriods', () => {
  it('devuelve id, name y schoolYear derivado de starts_on', async () => {
    const { svc } = service({
      grading_periods: [
        {
          data: [
            { id: 'p1', name: '1.er trimestre', starts_on: '2026-03-02' },
            { id: 'p2', name: '2.º trimestre', starts_on: '2026-06-01' },
          ],
          error: null,
        },
      ],
    });
    await expect(svc.listPeriods(teacher)).resolves.toEqual([
      { id: 'p1', name: '1.er trimestre', schoolYear: 2026 },
      { id: 'p2', name: '2.º trimestre', schoolYear: 2026 },
    ]);
  });
});

describe('GradesService · getSheet', () => {
  it('devuelve alumnos del curso con su nota o null', async () => {
    const { svc } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [
        { data: [{ student_id: ST1, value: 8.5 }], error: null },
      ],
    });
    await expect(svc.getSheet(teacher, SUBJECT, PERIOD)).resolves.toEqual([
      {
        student: { id: ST1, firstName: 'Ana', lastName: 'García' },
        value: 8.5,
        observations: null,
      },
      {
        student: { id: ST2, firstName: 'Luis', lastName: 'Pérez' },
        value: null,
        observations: null,
      },
    ]);
  });

  it('docente de otra materia → 403', async () => {
    const { svc } = service({
      ...baseTables,
      subjects: [{ data: subjectRow('mOtro'), error: null }],
    });
    await expect(
      svc.getSheet(teacher, SUBJECT, PERIOD),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('materia inexistente → 404', async () => {
    const { svc } = service({
      ...baseTables,
      subjects: [{ data: null, error: null }],
    });
    await expect(
      svc.getSheet(teacher, SUBJECT, PERIOD),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la planilla solo consulta alumnos activos (bajas excluidas)', async () => {
    const { svc, state } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [{ data: [], error: null }],
    });
    await svc.getSheet(teacher, SUBJECT, PERIOD);
    expect(state.students.calls).toContainEqual({
      op: 'eq',
      args: ['status', 'active'],
    });
  });
});

describe('GradesService · saveSheet', () => {
  const dto = (
    entries: {
      studentId: string;
      value: number | null;
      observations?: string;
    }[],
  ) => ({
    subjectId: SUBJECT,
    periodId: PERIOD,
    entries,
  });

  it('docente de otra materia → 403 y no escribe nada', async () => {
    const { svc, state } = service({
      subjects: [{ data: subjectRow('mOtro'), error: null }],
    });
    await expect(
      svc.saveSheet(teacher, dto([{ studentId: ST1, value: 8 }])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.grades?.calls ?? []).toEqual([]);
  });

  it('nota fuera de rango 1-10 → 400 y no guarda nada del lote', async () => {
    for (const value of [0.5, 10.01, Number.NaN, 'ocho' as any]) {
      const { svc, state } = service({
        ...baseTables,
        students: [{ data: roster, error: null }],
      });
      await expect(
        svc.saveSheet(
          teacher,
          dto([
            { studentId: ST1, value: 8 },
            { studentId: ST2, value },
          ]),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((state.grades?.calls ?? []).some((c) => c.op === 'upsert')).toBe(false);
      expect(state.grade_changes?.calls ?? []).toEqual([]);
    }
  });

  it('nota con más de 2 decimales → 400', async () => {
    const { svc, state } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
    });
    await expect(
      svc.saveSheet(teacher, dto([{ studentId: ST1, value: 7.123 }])),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((state.grades?.calls ?? []).some((c) => c.op === 'upsert')).toBe(false);
  });

  it('estudiante ajeno al curso → 400 y no guarda nada', async () => {
    const { svc, state } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
    });
    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, value: 8 },
          { studentId: 'dddddddd-0000-0000-0000-000000000099', value: 9 },
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((state.grades?.calls ?? []).some((c) => c.op === 'upsert')).toBe(false);
  });

  it('upsert + auditoría solo en lo que cambió, null no crea ni borra, emite grades.saved', async () => {
    const { svc, state, events } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [
        // notas existentes: ST1 ya vale 8.5 (sin cambio), ST2 no tiene fila
        { data: [{ id: 'g1', student_id: ST1, value: 8.5 }], error: null },
        // resultado del upsert().select()
        { data: [{ id: 'g2', student_id: ST2 }], error: null },
      ],
      grade_changes: [{ data: null, error: null }],
    });

    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, value: 8.5 }, // igual a la anterior → skip
          { studentId: ST2, value: 7.25 }, // nueva → upsert + auditoría
        ]),
      ),
    ).resolves.toEqual({ saved: 1 });

    const upserts = state.grades.calls.filter((c) => c.op === 'upsert');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args[0]).toEqual([
      expect.objectContaining({
        student_id: ST2,
        subject_id: SUBJECT,
        period_id: PERIOD,
        institution_id: INST,
        value: 7.25,
      }),
    ]);

    const audits = state.grade_changes.calls.filter((c) => c.op === 'insert');
    expect(audits).toHaveLength(1);
    expect(audits[0].args[0]).toEqual([
      {
        grade_id: 'g2',
        institution_id: INST,
        previous_value: null,
        new_value: 7.25,
        changed_by: 'uT',
      },
    ]);

    expect(events.emit).toHaveBeenCalledWith('grades.saved', {
      institutionId: INST,
      subjectId: SUBJECT,
      periodId: PERIOD,
      studentIds: [ST2],
    });
  });

  it('audita previous_value cuando la nota ya existía', async () => {
    const { svc, state } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [
        { data: [{ id: 'g1', student_id: ST1, value: 6 }], error: null },
        { data: [{ id: 'g1', student_id: ST1 }], error: null },
      ],
      grade_changes: [{ data: null, error: null }],
    });
    await svc.saveSheet(teacher, dto([{ studentId: ST1, value: 9 }]));
    expect(state.grade_changes.calls[0].args[0]).toEqual([
      {
        grade_id: 'g1',
        institution_id: INST,
        previous_value: 6,
        new_value: 9,
        changed_by: 'uT',
      },
    ]);
  });

  it('observación de más de 500 caracteres → 400 y no guarda nada', async () => {
    const { svc, state } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
    });
    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, value: 8, observations: 'x'.repeat(501) },
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((state.grades?.calls ?? []).some((c) => c.op === 'upsert')).toBe(false);
    expect(state.grade_changes?.calls ?? []).toEqual([]);
  });

  it('guarda observaciones y audita/notifica solo los cambios de nota', async () => {
    const { svc, state, events } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [
        // ST1 ya tiene nota 8 sin observación
        {
          data: [{ id: 'g1', student_id: ST1, value: 8, observations: null }],
          error: null,
        },
        // resultado del upsert().select()
        {
          data: [
            { id: 'g1', student_id: ST1 },
            { id: 'g2', student_id: ST2 },
          ],
          error: null,
        },
      ],
      grade_changes: [{ data: null, error: null }],
    });

    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, value: 8, observations: 'Revisar oral' },
          { studentId: ST2, value: 7, observations: 'Buen trabajo' },
        ]),
      ),
    ).resolves.toEqual({ saved: 2 });

    const upserts = state.grades.calls.filter((c) => c.op === 'upsert');
    expect(upserts[0].args[0]).toEqual([
      expect.objectContaining({
        student_id: ST1,
        value: 8,
        observations: 'Revisar oral',
      }),
      expect.objectContaining({
        student_id: ST2,
        value: 7,
        observations: 'Buen trabajo',
      }),
    ]);

    // solo ST2 cambió de nota → una sola fila de auditoría
    const audits = state.grade_changes.calls.filter((c) => c.op === 'insert');
    expect(audits).toHaveLength(1);
    expect(audits[0].args[0]).toEqual([
      {
        grade_id: 'g2',
        institution_id: INST,
        previous_value: null,
        new_value: 7,
        changed_by: 'uT',
      },
    ]);

    // ST1 solo cambió la observación → queda fuera de la notificación
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('grades.saved', {
      institutionId: INST,
      subjectId: SUBJECT,
      periodId: PERIOD,
      studentIds: [ST2],
    });
  });

  it('cambio exclusivo de observations persiste pero no emite grades.saved', async () => {
    const { svc, state, events } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [
        // ST1 ya tiene nota 8 sin observación
        {
          data: [{ id: 'g1', student_id: ST1, value: 8, observations: null }],
          error: null,
        },
        // resultado del upsert().select()
        { data: [{ id: 'g1', student_id: ST1 }], error: null },
      ],
      grade_changes: [{ data: null, error: null }],
    });

    await expect(
      svc.saveSheet(
        teacher,
        dto([{ studentId: ST1, value: 8, observations: 'Revisar oral' }]),
      ),
    ).resolves.toEqual({ saved: 1 });

    const upserts = state.grades.calls.filter((c) => c.op === 'upsert');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].args[0]).toEqual([
      expect.objectContaining({
        student_id: ST1,
        value: 8,
        observations: 'Revisar oral',
      }),
    ]);

    // sin cambio de nota no hay auditoría ni notificación "Nueva nota"
    expect(state.grade_changes.calls.filter((c) => c.op === 'insert')).toEqual(
      [],
    );
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('observations omitida conserva la observación previa', async () => {
    const { svc, state } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [
        {
          data: [
            {
              id: 'g1',
              student_id: ST1,
              value: 8,
              observations: 'Revisar oral',
            },
          ],
          error: null,
        },
        { data: [{ id: 'g1', student_id: ST1 }], error: null },
      ],
      grade_changes: [{ data: null, error: null }],
    });

    await svc.saveSheet(teacher, dto([{ studentId: ST1, value: 9 }]));

    const upserts = state.grades.calls.filter((c) => c.op === 'upsert');
    expect(upserts[0].args[0]).toEqual([
      expect.objectContaining({
        student_id: ST1,
        value: 9,
        observations: 'Revisar oral',
      }),
    ]);
  });

  it('re-guardar la misma planilla es idempotente: saved 0, sin writes ni evento', async () => {
    const { svc, state, events } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [
        {
          data: [
            { id: 'g1', student_id: ST1, value: 8.5 },
            { id: 'g2', student_id: ST2, value: 7 },
          ],
          error: null,
        },
      ],
    });
    await expect(
      svc.saveSheet(
        teacher,
        dto([
          { studentId: ST1, value: 8.5 },
          { studentId: ST2, value: 7 },
        ]),
      ),
    ).resolves.toEqual({ saved: 0 });
    expect((state.grades?.calls ?? []).some((c) => c.op === 'upsert')).toBe(false);
    expect(state.grade_changes?.calls ?? []).toEqual([]);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('entries con value null no generan escrituras', async () => {
    const { svc, state, events } = service({
      ...baseTables,
      students: [{ data: roster, error: null }],
      grades: [{ data: [], error: null }],
    });
    await expect(
      svc.saveSheet(teacher, dto([{ studentId: ST1, value: null }])),
    ).resolves.toEqual({ saved: 0 });
    expect((state.grades?.calls ?? []).some((c) => c.op === 'upsert')).toBe(false);
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('GradesService · getStudentGrades', () => {
  const studentRow = { id: ST1, course_id: 'c1' };

  const gradeRows = [
    {
      value: 9,
      observations: 'Excelente desempeño',
      subjects: { id: 's-mat', name: 'Matemática' },
      grading_periods: { id: 'p2', name: '2.º trimestre' },
    },
    {
      value: 7.5,
      observations: null,
      subjects: { id: 's-len', name: 'Lengua' },
      grading_periods: { id: 'p1', name: '1.er trimestre' },
    },
    {
      value: 8,
      observations: null,
      subjects: { id: 's-mat', name: 'Matemática' },
      grading_periods: { id: 'p1', name: '1.er trimestre' },
    },
    {
      value: null,
      observations: null,
      subjects: { id: 's-his', name: 'Historia' },
      grading_periods: { id: 'p1', name: '1.er trimestre' },
    },
  ];

  const sortedGrades = [
    {
      subject: { id: 's-len', name: 'Lengua' },
      period: { id: 'p1', name: '1.er trimestre' },
      value: 7.5,
      observations: null,
    },
    {
      subject: { id: 's-mat', name: 'Matemática' },
      period: { id: 'p1', name: '1.er trimestre' },
      value: 8,
      observations: null,
    },
    {
      subject: { id: 's-mat', name: 'Matemática' },
      period: { id: 'p2', name: '2.º trimestre' },
      value: 9,
      observations: 'Excelente desempeño',
    },
  ];

  it('tutor no vinculado al alumno → 403 y no consulta notas', async () => {
    const { svc, state } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [{ data: null, error: null }],
    });
    await expect(
      svc.getStudentGrades(guardian, ST1),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.grades?.calls ?? []).toEqual([]);
  });

  it('tutor vinculado → notas ordenadas por materia y período, sin nulls', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [{ data: { id: 'l1' }, error: null }],
      grades: [{ data: gradeRows, error: null }],
    });
    await expect(
      svc.getStudentGrades(guardian, ST1),
    ).resolves.toEqual(sortedGrades);
  });

  it('docente sin materias en el curso del alumno → 403', async () => {
    const { svc, state } = service({
      students: [{ data: studentRow, error: null }],
      subjects: [{ data: [], error: null }],
    });
    await expect(
      svc.getStudentGrades(teacher, ST1),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.grades?.calls ?? []).toEqual([]);
  });

  it('docente con materia en el curso del alumno → devuelve notas', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      subjects: [{ data: [{ id: SUBJECT }], error: null }],
      grades: [{ data: gradeRows, error: null }],
    });
    await expect(
      svc.getStudentGrades(teacher, ST1),
    ).resolves.toEqual(sortedGrades);
  });

  it('alumno inexistente o de otra institución → 404', async () => {
    for (const member of [admin, guardian, teacher]) {
      const { svc } = service({
        students: [{ data: null, error: null }],
      });
      await expect(
        svc.getStudentGrades(member, ST1),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('studentId inválido → 400', async () => {
    const { svc } = service({});
    await expect(
      svc.getStudentGrades(admin, 'no-es-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin y director → notas sin validación de vínculo ni materias', async () => {
    for (const member of [admin, director]) {
      const { svc, state } = service({
        students: [{ data: studentRow, error: null }],
        grades: [{ data: gradeRows, error: null }],
      });
      await expect(
        svc.getStudentGrades(member, ST1),
      ).resolves.toEqual(sortedGrades);
      expect(state.guardian_links?.calls ?? []).toEqual([]);
      expect(state.subjects?.calls ?? []).toEqual([]);
    }
  });
});
