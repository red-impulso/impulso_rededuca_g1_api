import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../auth/auth.guard.js';
import { MembershipGuard } from '../../auth/membership.guard.js';
import { ROLES_KEY } from '../../auth/roles.decorator.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import {
  CourseAssignmentsController,
  SubjectTeacherController,
  TeachersController,
} from './teachers.controller.js';
import { TeachersService } from './teachers.service.js';

const INST = '11111111-2222-3333-4444-555555555555';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const SUBJ = 'eeeeeeee-0000-0000-0000-000000000001';

/** MembershipGuard real con una membresía del rol dado sobre `handler`. */
function membershipGuardContext(
  controller: object,
  handler: object,
  opts: { role?: string } = {},
) {
  const request: any = {
    headers: { 'x-institution-id': INST },
    user: { id: 'u1', email: 'a@b.c' },
  };
  const context = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const rows = opts.role
    ? [{ id: 'm1', user_id: 'u1', institution_id: INST, role: opts.role }]
    : [];
  const q: any = {
    select: () => q,
    eq: () => q,
    then: (res: any, rej: any) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  const guard = new MembershipGuard(
    { admin: { from: () => q } } as any,
    new Reflector(),
  );
  return { guard, context, request };
}

function authGuardContext(
  controller: object,
  handler: object,
  headers: Record<string, string>,
) {
  const request: any = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

describe('TeachersController + SubjectTeacherController + CourseAssignmentsController', () => {
  let teachers: TeachersController;
  let subjectTeacher: SubjectTeacherController;
  let courseAssignments: CourseAssignmentsController;
  let service: Record<
    'list' | 'detail' | 'update' | 'assignTeacher' | 'courseAssignments',
    ReturnType<typeof vi.fn>
  >;

  beforeEach(async () => {
    service = {
      list: vi.fn(),
      detail: vi.fn(),
      update: vi.fn(),
      assignTeacher: vi.fn(),
      courseAssignments: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [
        TeachersController,
        SubjectTeacherController,
        CourseAssignmentsController,
      ],
      providers: [
        { provide: TeachersService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    teachers = module.get(TeachersController);
    subjectTeacher = module.get(SubjectTeacherController);
    courseAssignments = module.get(CourseAssignmentsController);
  });

  it.each([
    ['TeachersController', TeachersController],
    ['SubjectTeacherController', SubjectTeacherController],
    ['CourseAssignmentsController', CourseAssignmentsController],
  ])(
    '%s exige AuthGuard + MembershipGuard y @Roles("admin","director")',
    (_n, controller) => {
      const reflector = new Reflector();
      const guards = Reflect.getMetadata('__guards__', controller);
      expect(guards).toContain(AuthGuard);
      expect(guards).toContain(MembershipGuard);
      expect(reflector.get(ROLES_KEY, controller)).toEqual([
        'admin',
        'director',
      ]);
    },
  );

  describe('restricción de acceso', () => {
    const routes: [string, object, () => object][] = [
      ['GET /teachers', TeachersController, () => teachers.list],
      ['GET /teachers/:id', TeachersController, () => teachers.detail],
      ['PATCH /teachers/:id', TeachersController, () => teachers.update],
      [
        'PUT /subjects/:id/teacher',
        SubjectTeacherController,
        () => subjectTeacher.assign,
      ],
      [
        'GET /courses/:id/assignments',
        CourseAssignmentsController,
        () => courseAssignments.assignments,
      ],
    ];

    for (const [name, controller, handler] of routes) {
      it(`${name}: sin token → 401`, async () => {
        const { guard, context } = authGuardContext(
          controller,
          handler(),
          {},
        );
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      });

      it.each(['teacher', 'guardian'])(`${name}: rol %s → 403`, async (role) => {
        const { guard, context } = membershipGuardContext(
          controller,
          handler(),
          { role },
        );
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });

      it.each(['admin', 'director'])(
        `${name}: rol %s → pasa el guard`,
        async (role) => {
          const { guard, context } = membershipGuardContext(
            controller,
            handler(),
            { role },
          );
          await expect(guard.canActivate(context)).resolves.toBe(true);
        },
      );
    }
  });

  const membership = {
    id: 'm1',
    userId: 'u1',
    institutionId: INST,
    role: 'admin' as const,
  };

  it('GET /teachers delega los query params en el service', async () => {
    service.list.mockResolvedValue({ data: [], total: 0, page: 2, limit: 10 });
    await expect(
      teachers.list(
        membership,
        'lau',
        'activo',
        'titular',
        COURSE,
        SUBJ,
        'morning',
        'name',
        2,
        10,
      ),
    ).resolves.toEqual({ data: [], total: 0, page: 2, limit: 10 });
    expect(service.list).toHaveBeenCalledWith(membership, {
      q: 'lau',
      status: 'activo',
      employmentStatus: 'titular',
      courseId: COURSE,
      subjectId: SUBJ,
      shift: 'morning',
      sort: 'name',
      page: 2,
      limit: 10,
    });
  });

  it('GET /teachers sin params usa page 1 y limit 25', async () => {
    service.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 });
    await teachers.list(membership);
    expect(service.list).toHaveBeenCalledWith(membership, {
      q: undefined,
      status: undefined,
      employmentStatus: undefined,
      courseId: undefined,
      subjectId: undefined,
      shift: undefined,
      sort: undefined,
      page: 1,
      limit: 25,
    });
  });

  it('GET /teachers/:id delega en el service', async () => {
    service.detail.mockResolvedValue({ id: T1 });
    await expect(teachers.detail(membership, T1)).resolves.toEqual({ id: T1 });
    expect(service.detail).toHaveBeenCalledWith(membership, T1);
  });

  it('PATCH /teachers/:id delega en el service', async () => {
    const dto = { status: 'licencia' as const };
    service.update.mockResolvedValue({ id: T1, status: 'licencia' });
    await expect(
      teachers.update(membership, T1, dto),
    ).resolves.toEqual({ id: T1, status: 'licencia' });
    expect(service.update).toHaveBeenCalledWith(membership, T1, dto);
  });

  it('PUT /subjects/:id/teacher delega en el service', async () => {
    const dto = { teacherMembershipId: T1 };
    service.assignTeacher.mockResolvedValue({ id: SUBJ, teacher: { id: T1 } });
    await expect(
      subjectTeacher.assign(membership, SUBJ, dto),
    ).resolves.toEqual({ id: SUBJ, teacher: { id: T1 } });
    expect(service.assignTeacher).toHaveBeenCalledWith(membership, SUBJ, dto);
  });

  it('PUT /subjects/:id/teacher con null desasigna', async () => {
    const dto = { teacherMembershipId: null };
    service.assignTeacher.mockResolvedValue({ id: SUBJ, teacher: null });
    await subjectTeacher.assign(membership, SUBJ, dto);
    expect(service.assignTeacher).toHaveBeenCalledWith(membership, SUBJ, dto);
  });

  it('GET /courses/:id/assignments delega en el service', async () => {
    service.courseAssignments.mockResolvedValue({
      course: { id: COURSE },
      subjects: [],
    });
    await expect(
      courseAssignments.assignments(membership, COURSE),
    ).resolves.toEqual({ course: { id: COURSE }, subjects: [] });
    expect(service.courseAssignments).toHaveBeenCalledWith(membership, COURSE);
  });
});
