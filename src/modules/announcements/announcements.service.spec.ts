import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { AnnouncementsService } from './announcements.service.js';

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
  const events = { emit: vi.fn() };
  const svc = new AnnouncementsService({ admin: db } as any, events as any);
  return { svc, state, events };
}

const INST = '11111111-2222-3333-4444-555555555555';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const OTHER_COURSE = 'dddddddd-1111-2222-3333-444444444445';
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

const courseRow = { id: COURSE };
const studentRow = { id: ST1, course_id: COURSE };
const teacherSubject = [{ id: 's1', course_id: COURSE }];

const createdRow = {
  id: 'ann-1',
  institution_id: INST,
  author_id: 'uT',
  scope: 'course',
  course_id: COURSE,
  student_id: null,
  title: 'Reunión',
  body: 'Mañana 9hs',
  created_at: '2026-11-02T10:00:00Z',
};

describe('AnnouncementsService · create', () => {
  const dto = (over: Record<string, unknown> = {}) => ({
    scope: 'course' as const,
    courseId: COURSE,
    title: 'Reunión',
    body: 'Mañana 9hs',
    ...over,
  });

  it('tutor intentando publicar → 403 y no escribe nada', async () => {
    const { svc, state } = service({});
    await expect(svc.create(guardian, dto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      svc.create(guardian, dto({ scope: 'institution', courseId: undefined })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.announcements?.calls ?? []).toEqual([]);
  });

  it('docente con scope institution → 403', async () => {
    const { svc, state } = service({});
    await expect(
      svc.create(teacher, dto({ scope: 'institution', courseId: undefined })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.announcements?.calls ?? []).toEqual([]);
  });

  it('docente con scope student → 403', async () => {
    const { svc, state } = service({});
    await expect(
      svc.create(teacher, dto({ scope: 'student', studentId: ST1 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.announcements?.calls ?? []).toEqual([]);
  });

  it('docente publicando a curso ajeno (sin materias) → 403', async () => {
    const { svc, state } = service({
      courses: [{ data: courseRow, error: null }],
      subjects: [{ data: [], error: null }],
    });
    await expect(svc.create(teacher, dto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.announcements?.calls ?? []).toEqual([]);
  });

  it('docente publicando en su curso → crea y emite announcement.created', async () => {
    const { svc, state, events } = service({
      courses: [{ data: courseRow, error: null }],
      subjects: [{ data: teacherSubject, error: null }],
      announcements: [{ data: createdRow, error: null }],
    });

    await expect(svc.create(teacher, dto())).resolves.toEqual(createdRow);

    const inserts = state.announcements.calls.filter(
      (c) => c.op === 'insert',
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toEqual({
      institution_id: INST,
      author_id: 'uT',
      scope: 'course',
      course_id: COURSE,
      student_id: null,
      title: 'Reunión',
      body: 'Mañana 9hs',
    });

    expect(events.emit).toHaveBeenCalledWith('announcement.created', {
      institutionId: INST,
      announcementId: 'ann-1',
      scope: 'course',
      courseId: COURSE,
      studentId: null,
      title: 'Reunión',
    });
  });

  it('admin y director pueden publicar en cualquier scope', async () => {
    for (const member of [admin, director]) {
      for (const [scope, extra] of [
        ['institution', {}],
        ['course', { courseId: COURSE }],
        ['student', { studentId: ST1, courseId: undefined }],
      ] as const) {
        const { svc, events } = service({
          courses: [{ data: courseRow, error: null }],
          students: [{ data: studentRow, error: null }],
          announcements: [
            { data: { ...createdRow, scope }, error: null },
          ],
        });
        await expect(
          svc.create(member, dto({ scope, ...extra })),
        ).resolves.toMatchObject({ scope });
        expect(events.emit).toHaveBeenCalledWith(
          'announcement.created',
          expect.objectContaining({ scope, institutionId: INST }),
        );
      }
    }
  });

  it('admin publicando scope student guarda student_id y emite el evento', async () => {
    const { svc, state, events } = service({
      students: [{ data: studentRow, error: null }],
      announcements: [
        {
          data: { ...createdRow, scope: 'student', student_id: ST1, course_id: null },
          error: null,
        },
      ],
    });
    await svc.create(
      admin,
      dto({ scope: 'student', studentId: ST1, courseId: undefined }),
    );
    expect(state.announcements.calls[0].args[0]).toMatchObject({
      scope: 'student',
      student_id: ST1,
      course_id: null,
      author_id: 'uA',
    });
    expect(events.emit).toHaveBeenCalledWith('announcement.created', {
      institutionId: INST,
      announcementId: 'ann-1',
      scope: 'student',
      courseId: null,
      studentId: ST1,
      title: 'Reunión',
    });
  });

  it('title vacío o solo espacios → 400', async () => {
    for (const title of ['', '   ']) {
      const { svc, state } = service({});
      await expect(
        svc.create(admin, dto({ title })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(state.announcements?.calls ?? []).toEqual([]);
    }
  });

  it('body vacío o solo espacios → 400', async () => {
    for (const body of ['', '   ']) {
      const { svc, state } = service({});
      await expect(
        svc.create(admin, dto({ body })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(state.announcements?.calls ?? []).toEqual([]);
    }
  });

  it('scope course sin courseId → 400', async () => {
    const { svc, state } = service({});
    await expect(
      svc.create(admin, dto({ courseId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.announcements?.calls ?? []).toEqual([]);
  });

  it('scope student sin studentId → 400', async () => {
    const { svc, state } = service({});
    await expect(
      svc.create(admin, dto({ scope: 'student', studentId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.announcements?.calls ?? []).toEqual([]);
  });

  it('scope inválido → 400', async () => {
    const { svc } = service({});
    await expect(
      svc.create(admin, dto({ scope: 'everyone' as any })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('courseId inexistente o de otra institución → 404', async () => {
    const { svc } = service({
      courses: [{ data: null, error: null }],
    });
    await expect(svc.create(admin, dto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('studentId inexistente o de otra institución → 404', async () => {
    const { svc } = service({
      students: [{ data: null, error: null }],
    });
    await expect(
      svc.create(admin, dto({ scope: 'student', studentId: ST1 })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AnnouncementsService · list', () => {
  const rows = [
    {
      id: 'a1',
      author_id: 'uA',
      scope: 'institution',
      course_id: null,
      student_id: null,
      title: 'General',
      body: 'Para todos',
      created_at: '2026-11-02T10:00:00Z',
    },
    {
      id: 'a2',
      author_id: 'uT',
      scope: 'course',
      course_id: COURSE,
      student_id: null,
      title: 'Curso propio',
      body: 'Aviso',
      created_at: '2026-11-02T09:00:00Z',
    },
    {
      id: 'a3',
      author_id: 'uA',
      scope: 'course',
      course_id: OTHER_COURSE,
      student_id: null,
      title: 'Curso ajeno',
      body: 'Aviso',
      created_at: '2026-11-02T08:00:00Z',
    },
    {
      id: 'a4',
      author_id: 'uA',
      scope: 'student',
      course_id: null,
      student_id: ST1,
      title: 'Hijo propio',
      body: 'Aviso',
      created_at: '2026-11-02T07:00:00Z',
    },
    {
      id: 'a5',
      author_id: 'uA',
      scope: 'student',
      course_id: null,
      student_id: ST2,
      title: 'Alumno ajeno',
      body: 'Aviso',
      created_at: '2026-11-02T06:00:00Z',
    },
  ];

  const related = {
    profiles: [
      {
        data: [
          { id: 'uA', full_name: 'Admin Uno' },
          { id: 'uT', full_name: 'Docente Dos' },
        ],
        error: null,
      },
    ],
    courses: [
      {
        data: [
          { id: COURSE, name: '3° A' },
          { id: OTHER_COURSE, name: '5° B' },
        ],
        error: null,
      },
    ],
  };

  it('admin y director ven todos los comunicados, orden desc por created_at', async () => {
    for (const member of [admin, director]) {
      const { svc, state } = service({
        announcements: [{ data: rows, error: null }],
        ...related,
        students: [
          {
            data: [
              { id: ST1, first_name: 'Ana', last_name: 'García' },
              { id: ST2, first_name: 'Luis', last_name: 'Pérez' },
            ],
            error: null,
          },
        ],
      });
      const result = await svc.list(member);
      expect(result.map((r) => r.id)).toEqual([
        'a1',
        'a2',
        'a3',
        'a4',
        'a5',
      ]);
      expect(
        state.announcements.calls.some(
          (c) =>
            c.op === 'order' &&
            c.args[0] === 'created_at' &&
            (c.args[1] as any)?.ascending === false,
        ),
      ).toBe(true);
      // admin/director no consultan vínculos ni materias
      expect(state.guardian_links?.calls ?? []).toEqual([]);
    }
  });

  it('docente ve institución + cursos donde enseña, no cursos ajenos ni alumnos', async () => {
    const { svc } = service({
      subjects: [{ data: teacherSubject, error: null }],
      announcements: [{ data: rows, error: null }],
      profiles: related.profiles,
      courses: related.courses,
    });
    const result = await svc.list(teacher);
    expect(result.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it('docente sin materias asignadas solo ve comunicados de institución', async () => {
    const { svc } = service({
      subjects: [{ data: [], error: null }],
      announcements: [{ data: rows, error: null }],
      profiles: related.profiles,
    });
    const result = await svc.list(teacher);
    expect(result.map((r) => r.id)).toEqual(['a1']);
  });

  it('tutor ve institución + cursos de sus hijos + comunicados a sus hijos', async () => {
    const { svc } = service({
      guardian_links: [
        { data: [{ student_id: ST1 }], error: null },
      ],
      students: [
        { data: [{ id: ST1, course_id: COURSE }], error: null },
        // segunda consulta: nombres de alumnos para formatear
        {
          data: [{ id: ST1, first_name: 'Ana', last_name: 'García' }],
          error: null,
        },
      ],
      announcements: [{ data: rows, error: null }],
      profiles: related.profiles,
      courses: related.courses,
    });
    const result = await svc.list(guardian);
    // ve a1 (institution), a2 (curso de su hijo), a4 (dirigido a su hijo);
    // NO ve a3 (curso ajeno) ni a5 (alumno ajeno)
    expect(result.map((r) => r.id)).toEqual(['a1', 'a2', 'a4']);
  });

  it('tutor sin hijos vinculados solo ve comunicados de institución', async () => {
    const { svc } = service({
      guardian_links: [{ data: [], error: null }],
      announcements: [{ data: rows, error: null }],
      profiles: related.profiles,
    });
    const result = await svc.list(guardian);
    expect(result.map((r) => r.id)).toEqual(['a1']);
  });

  it('formatea autor, curso y alumno cuando aplica', async () => {
    const { svc } = service({
      announcements: [{ data: rows, error: null }],
      ...related,
      students: [
        {
          data: [
            { id: ST1, first_name: 'Ana', last_name: 'García' },
            { id: ST2, first_name: 'Luis', last_name: 'Pérez' },
          ],
          error: null,
        },
      ],
    });
    const result = await svc.list(admin);

    expect(result[0]).toEqual({
      id: 'a1',
      scope: 'institution',
      title: 'General',
      body: 'Para todos',
      createdAt: '2026-11-02T10:00:00Z',
      author: { id: 'uA', fullName: 'Admin Uno' },
      course: null,
      student: null,
    });
    expect(result[1].author).toEqual({ id: 'uT', fullName: 'Docente Dos' });
    expect(result[1].course).toEqual({ id: COURSE, name: '3° A' });
    expect(result[3].student).toEqual({
      id: ST1,
      firstName: 'Ana',
      lastName: 'García',
    });
  });

  it('sin comunicados → lista vacía sin consultar tablas relacionadas', async () => {
    const { svc, state } = service({
      announcements: [{ data: [], error: null }],
    });
    await expect(svc.list(admin)).resolves.toEqual([]);
    expect(state.profiles?.calls ?? []).toEqual([]);
    expect(state.students?.calls ?? []).toEqual([]);
  });
});
