import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { NotificationsService } from './notifications.service.js';

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
        is: (...args: unknown[]) => (
          table.calls.push({ op: 'is', args }), q
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
        update: (...args: unknown[]) => (
          table.calls.push({ op: 'update', args }), q
        ),
        delete: (...args: unknown[]) => (
          table.calls.push({ op: 'delete', args }), q
        ),
        insert: (...args: unknown[]) => (
          table.calls.push({ op: 'insert', args }), q
        ),
        maybeSingle: () => Promise.resolve(next()),
        single: () => Promise.resolve(next()),
        then: (res: any, rej: any) => Promise.resolve(next()).then(res, rej),
      };
      return q;
    },
  };
  return { db, state };
}

function service(init: Record<string, unknown[]>) {
  const { db, state } = tables(init);
  const svc = new NotificationsService({ admin: db } as any);
  return { svc, state };
}

const INST = '11111111-2222-3333-4444-555555555555';
const OTHER_INST = '11111111-2222-3333-4444-555555555556';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const SUBJECT = 'eeeeeeee-1111-2222-3333-444444444444';
const ST1 = 'cccccccc-0000-0000-0000-000000000001';
const ST2 = 'cccccccc-0000-0000-0000-000000000002';
const ST3 = 'cccccccc-0000-0000-0000-000000000003';

const guardian: Membership = {
  id: 'mG',
  userId: 'uG',
  institutionId: INST,
  role: 'guardian',
};

describe('NotificationsService · grades.saved', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    institutionId: INST,
    subjectId: SUBJECT,
    periodId: 'period-1',
    studentIds: [ST1, ST2, ST3],
    ...over,
  });

  it('crea una notificación por tutor de cada alumno afectado', async () => {
    const { svc, state } = service({
      subjects: [{ data: { name: 'Matemática' }, error: null }],
      guardian_links: [
        {
          data: [
            { student_id: ST1, guardian_membership_id: 'mG1' },
            { student_id: ST1, guardian_membership_id: 'mG2' },
            { student_id: ST2, guardian_membership_id: 'mG3' },
          ],
          error: null,
        },
      ],
      memberships: [
        {
          data: [
            { id: 'mG1', user_id: 'uG1' },
            { id: 'mG2', user_id: 'uG2' },
            { id: 'mG3', user_id: 'uG3' },
          ],
          error: null,
        },
      ],
      notifications: [{ data: null, error: null }],
    });

    await svc.onGradesSaved(event());

    const inserts = state.notifications.calls.filter(
      (c) => c.op === 'insert',
    );
    expect(inserts).toHaveLength(1);
    const rows = inserts[0].args[0] as any[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.recipient_id).sort()).toEqual([
      'uG1',
      'uG2',
      'uG3',
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        institution_id: INST,
        title: 'Nueva nota',
        body: 'Nueva nota en Matemática',
        type: 'grade',
        link: `/hijos/${row.student_id}/notas`,
      });
    }
    expect(rows.map((r) => r.student_id).sort()).toEqual([ST1, ST1, ST2].sort());
  });

  it('alumno sin tutores vinculados no genera notificación', async () => {
    const { svc, state } = service({
      subjects: [{ data: { name: 'Lengua' }, error: null }],
      guardian_links: [
        { data: [{ student_id: ST1, guardian_membership_id: 'mG1' }], error: null },
      ],
      memberships: [{ data: [{ id: 'mG1', user_id: 'uG1' }], error: null }],
      notifications: [{ data: null, error: null }],
    });

    await svc.onGradesSaved(event({ studentIds: [ST1, ST3] }));

    const rows = state.notifications.calls.find((c) => c.op === 'insert')
      ?.args[0] as any[];
    expect(rows.map((r) => r.recipient_id)).toEqual(['uG1']);
  });

  it('sin studentIds no consulta ni escribe nada', async () => {
    const { svc, state } = service({});
    await svc.onGradesSaved(event({ studentIds: [] }));
    expect(state.subjects?.calls ?? []).toEqual([]);
    expect(state.notifications?.calls ?? []).toEqual([]);
  });

  it('sin vínculos no inserta notificaciones', async () => {
    const { svc, state } = service({
      subjects: [{ data: { name: 'Historia' }, error: null }],
      guardian_links: [{ data: [], error: null }],
    });
    await svc.onGradesSaved(event());
    expect(state.memberships?.calls ?? []).toEqual([]);
    expect(state.notifications?.calls ?? []).toEqual([]);
  });
});

describe('NotificationsService · attendance.saved', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    institutionId: INST,
    courseId: COURSE,
    date: '2026-11-02',
    absentStudentIds: [ST1, ST2],
    ...over,
  });

  it('crea notificación por tutor solo de los alumnos ausentes', async () => {
    const { svc, state } = service({
      students: [
        {
          data: [
            { id: ST1, first_name: 'Ana', last_name: 'García' },
            { id: ST2, first_name: 'Luis', last_name: 'Pérez' },
          ],
          error: null,
        },
      ],
      guardian_links: [
        {
          data: [
            { student_id: ST1, guardian_membership_id: 'mG1' },
            { student_id: ST2, guardian_membership_id: 'mG2' },
          ],
          error: null,
        },
      ],
      memberships: [
        {
          data: [
            { id: 'mG1', user_id: 'uG1' },
            { id: 'mG2', user_id: 'uG2' },
          ],
          error: null,
        },
      ],
      notifications: [{ data: null, error: null }],
    });

    await svc.onAttendanceSaved(event());

    const rows = state.notifications.calls.find((c) => c.op === 'insert')
      ?.args[0] as any[];
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      institution_id: INST,
      recipient_id: 'uG1',
      title: 'Inasistencia registrada',
      body: 'Ana García estuvo ausente el 2026-11-02',
      type: 'attendance',
      link: `/hijos/${ST1}/asistencia`,
      student_id: ST1,
    });
    expect(rows).toContainEqual({
      institution_id: INST,
      recipient_id: 'uG2',
      title: 'Inasistencia registrada',
      body: 'Luis Pérez estuvo ausente el 2026-11-02',
      type: 'attendance',
      link: `/hijos/${ST2}/asistencia`,
      student_id: ST2,
    });
  });

  it('sin ausentes no consulta ni escribe nada', async () => {
    const { svc, state } = service({});
    await svc.onAttendanceSaved(event({ absentStudentIds: [] }));
    expect(state.students?.calls ?? []).toEqual([]);
    expect(state.notifications?.calls ?? []).toEqual([]);
  });
});

describe('NotificationsService · announcement.created', () => {
  const base = {
    institutionId: INST,
    announcementId: 'ann-1',
    title: 'Reunión de padres',
  };

  it("scope 'student': solo tutores de ese alumno", async () => {
    const { svc, state } = service({
      guardian_links: [
        { data: [{ student_id: ST1, guardian_membership_id: 'mG1' }], error: null },
      ],
      memberships: [{ data: [{ id: 'mG1', user_id: 'uG1' }], error: null }],
      notifications: [{ data: null, error: null }],
    });

    await svc.onAnnouncementCreated({
      ...base,
      scope: 'student',
      courseId: null,
      studentId: ST1,
    });

    const rows = state.notifications.calls.find((c) => c.op === 'insert')
      ?.args[0] as any[];
    expect(rows).toEqual([
      {
        institution_id: INST,
        recipient_id: 'uG1',
        title: 'Nuevo comunicado',
        body: 'Nuevo comunicado: Reunión de padres',
        type: 'announcement',
        link: '/comunicados',
      },
    ]);
    expect(state.students?.calls ?? []).toEqual([]);
  });

  it("scope 'course': tutores de todos los alumnos del curso, sin duplicados", async () => {
    const { svc, state } = service({
      students: [{ data: [{ id: ST1 }, { id: ST2 }], error: null }],
      guardian_links: [
        {
          data: [
            // mismo tutor vinculado a dos alumnos del curso
            { student_id: ST1, guardian_membership_id: 'mG1' },
            { student_id: ST2, guardian_membership_id: 'mG1' },
            { student_id: ST2, guardian_membership_id: 'mG2' },
          ],
          error: null,
        },
      ],
      memberships: [
        {
          data: [
            { id: 'mG1', user_id: 'uG1' },
            { id: 'mG2', user_id: 'uG2' },
          ],
          error: null,
        },
      ],
      notifications: [{ data: null, error: null }],
    });

    await svc.onAnnouncementCreated({
      ...base,
      scope: 'course',
      courseId: COURSE,
      studentId: null,
    });

    const rows = state.notifications.calls.find((c) => c.op === 'insert')
      ?.args[0] as any[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipient_id).sort()).toEqual(['uG1', 'uG2']);
  });

  it("scope 'institution': todos los tutores con membresía guardian activa", async () => {
    const { svc, state } = service({
      memberships: [
        { data: [{ user_id: 'uG1' }, { user_id: 'uG2' }], error: null },
      ],
      notifications: [{ data: null, error: null }],
    });

    await svc.onAnnouncementCreated({
      ...base,
      scope: 'institution',
      courseId: null,
      studentId: null,
    });

    const eqCalls = state.memberships.calls.filter((c) => c.op === 'eq');
    expect(eqCalls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    expect(eqCalls).toContainEqual({
      op: 'eq',
      args: ['role', 'guardian'],
    });

    const rows = state.notifications.calls.find((c) => c.op === 'insert')
      ?.args[0] as any[];
    expect(rows.map((r) => r.recipient_id).sort()).toEqual(['uG1', 'uG2']);
    expect(state.students?.calls ?? []).toEqual([]);
    expect(state.guardian_links?.calls ?? []).toEqual([]);
  });

  it('sin destinatarios no inserta nada', async () => {
    const { svc, state } = service({
      memberships: [{ data: [], error: null }],
    });
    await svc.onAnnouncementCreated({
      ...base,
      scope: 'institution',
      courseId: null,
      studentId: null,
    });
    expect(state.notifications?.calls ?? []).toEqual([]);
  });
});

describe('NotificationsService · list', () => {
  const rows = [
    {
      id: 'n2',
      title: 'Nuevo comunicado',
      body: 'Nuevo comunicado: Reunión',
      type: 'announcement',
      link: '/comunicados',
      student_id: null,
      read_at: null,
      created_at: '2026-11-02T11:00:00Z',
    },
    {
      id: 'n1',
      title: 'Nueva nota',
      body: 'Nueva nota en Matemática',
      type: 'grade',
      link: `/hijos/${ST1}/notas`,
      student_id: ST1,
      read_at: '2026-11-02T10:30:00Z',
      created_at: '2026-11-02T10:00:00Z',
    },
  ];

  it('filtra por usuario e institución, ordena desc y limita a 50', async () => {
    const { svc, state } = service({
      notifications: [{ data: rows, error: null }],
    });

    const result = await svc.list(guardian);

    const calls = state.notifications.calls;
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['recipient_id', 'uG'],
    });
    expect(calls).toContainEqual({
      op: 'order',
      args: ['created_at', { ascending: false }],
    });
    expect(calls).toContainEqual({ op: 'limit', args: [50] });

    expect(result).toEqual([
      {
        id: 'n2',
        title: 'Nuevo comunicado',
        body: 'Nuevo comunicado: Reunión',
        type: 'announcement',
        link: '/comunicados',
        studentId: null,
        readAt: null,
        createdAt: '2026-11-02T11:00:00Z',
      },
      {
        id: 'n1',
        title: 'Nueva nota',
        body: 'Nueva nota en Matemática',
        type: 'grade',
        link: `/hijos/${ST1}/notas`,
        studentId: ST1,
        readAt: '2026-11-02T10:30:00Z',
        createdAt: '2026-11-02T10:00:00Z',
      },
    ]);
  });

  it('sin notificaciones → lista vacía', async () => {
    const { svc } = service({
      notifications: [{ data: [], error: null }],
    });
    await expect(svc.list(guardian)).resolves.toEqual([]);
  });
});

describe('NotificationsService · unreadCount', () => {
  it('cuenta solo las no leídas del usuario en la institución', async () => {
    const { svc, state } = service({
      notifications: [{ data: [{ id: 'n1' }, { id: 'n2' }], error: null }],
    });

    await expect(svc.unreadCount(guardian)).resolves.toEqual({ count: 2 });

    const calls = state.notifications.calls;
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['recipient_id', 'uG'],
    });
    expect(calls).toContainEqual({ op: 'is', args: ['read_at', null] });
  });

  it('sin pendientes → count 0', async () => {
    const { svc } = service({
      notifications: [{ data: [], error: null }],
    });
    await expect(svc.unreadCount(guardian)).resolves.toEqual({ count: 0 });
  });
});

describe('NotificationsService · markRead', () => {
  const own = {
    id: 'n1',
    institution_id: INST,
    recipient_id: 'uG',
  };

  it('notificación propia → la marca como leída y retorna success', async () => {
    const { svc, state } = service({
      notifications: [
        { data: own, error: null },
        { data: [{ id: 'n1' }], error: null },
      ],
    });

    await expect(svc.markRead(guardian, 'n1')).resolves.toEqual({
      success: true,
    });

    const updates = state.notifications.calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0]).toHaveProperty('read_at');
  });

  it('notificación de otro usuario → 404 y no escribe', async () => {
    const { svc, state } = service({
      notifications: [
        { data: { ...own, recipient_id: 'uOtro' }, error: null },
      ],
    });

    await expect(svc.markRead(guardian, 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      state.notifications.calls.filter((c) => c.op === 'update'),
    ).toEqual([]);
  });

  it('notificación de otra institución → 404 y no escribe', async () => {
    const { svc, state } = service({
      notifications: [
        { data: { ...own, institution_id: OTHER_INST }, error: null },
      ],
    });

    await expect(svc.markRead(guardian, 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      state.notifications.calls.filter((c) => c.op === 'update'),
    ).toEqual([]);
  });

  it('notificación inexistente → 404', async () => {
    const { svc } = service({
      notifications: [{ data: null, error: null }],
    });
    await expect(svc.markRead(guardian, 'nX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('NotificationsService · remove', () => {
  const own = {
    id: 'n1',
    institution_id: INST,
    recipient_id: 'uG',
  };

  it('notificación propia → la borra por id', async () => {
    const { svc, state } = service({
      notifications: [
        { data: own, error: null },
        { data: null, error: null },
      ],
    });

    await expect(svc.remove(guardian, 'n1')).resolves.toBeUndefined();

    const deletes = state.notifications.calls.filter(
      (c) => c.op === 'delete',
    );
    expect(deletes).toHaveLength(1);
    expect(state.notifications.calls).toContainEqual({
      op: 'eq',
      args: ['id', 'n1'],
    });
  });

  it('notificación de otro usuario → 404 y no borra', async () => {
    const { svc, state } = service({
      notifications: [
        { data: { ...own, recipient_id: 'uOtro' }, error: null },
      ],
    });

    await expect(svc.remove(guardian, 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      state.notifications.calls.filter((c) => c.op === 'delete'),
    ).toEqual([]);
  });

  it('notificación de otra institución → 404 y no borra', async () => {
    const { svc, state } = service({
      notifications: [
        { data: { ...own, institution_id: OTHER_INST }, error: null },
      ],
    });

    await expect(svc.remove(guardian, 'n1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      state.notifications.calls.filter((c) => c.op === 'delete'),
    ).toEqual([]);
  });

  it('notificación inexistente → 404', async () => {
    const { svc } = service({
      notifications: [{ data: null, error: null }],
    });
    await expect(svc.remove(guardian, 'nX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('NotificationsService · markAllRead', () => {
  it('marca todas las pendientes del usuario y retorna cuántas', async () => {
    const { svc, state } = service({
      notifications: [
        { data: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }], error: null },
      ],
    });

    await expect(svc.markAllRead(guardian)).resolves.toEqual({ updated: 3 });

    const calls = state.notifications.calls;
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    expect(calls).toContainEqual({
      op: 'eq',
      args: ['recipient_id', 'uG'],
    });
    expect(calls).toContainEqual({ op: 'is', args: ['read_at', null] });
  });

  it('sin pendientes → updated 0', async () => {
    const { svc } = service({
      notifications: [{ data: [], error: null }],
    });
    await expect(svc.markAllRead(guardian)).resolves.toEqual({ updated: 0 });
  });
});
