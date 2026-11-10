import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { MembershipsService } from './memberships.service.js';

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

function service(init: Record<string, unknown[]>) {
  const { db, state } = tables(init);
  const svc = new MembershipsService({ admin: db } as any);
  return { svc, state };
}

const INST = '11111111-2222-3333-4444-555555555555';
const M_ADMIN = 'aaaaaaaa-0000-0000-0000-00000000000a';
const M_TEACHER = 'aaaaaaaa-0000-0000-0000-00000000000b';

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

const adminRow = {
  id: M_ADMIN,
  user_id: 'uA',
  institution_id: INST,
  role: 'admin',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
};

const teacherRow = {
  id: M_TEACHER,
  user_id: 'uT1',
  institution_id: INST,
  role: 'teacher',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
};

describe('MembershipsService · updateRole', () => {
  it('cambia el rol a teacher y devuelve la membresía (200)', async () => {
    const { svc, state } = service({
      memberships: [
        { data: adminRow, error: null },
        { data: null, count: 2, error: null },
        {
          data: { ...adminRow, role: 'teacher', updated_at: '2026-11-10' },
          error: null,
        },
      ],
    });

    await expect(
      svc.updateRole(admin, M_ADMIN, { role: 'teacher' }),
    ).resolves.toMatchObject({
      membershipId: M_ADMIN,
      userId: 'uA',
      role: 'teacher',
      status: 'active',
    });
    const upd = state.memberships.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toMatchObject({ role: 'teacher' });
  });

  it('cambio de rol no-admin no consulta el conteo de admins', async () => {
    const { svc, state } = service({
      memberships: [
        { data: teacherRow, error: null },
        {
          data: { ...teacherRow, role: 'director', updated_at: '2026-11-10' },
          error: null,
        },
      ],
    });
    await expect(
      svc.updateRole(admin, M_TEACHER, { role: 'director' }),
    ).resolves.toMatchObject({ role: 'director' });
    // Solo 2 consultas: membershipFor + update (sin conteo).
    expect(state.memberships.calls.filter((c) => c.op === 'select')).toHaveLength(2);
  });

  it('degradar al único admin activo → 409 (caso clave del backlog)', async () => {
    const { svc, state } = service({
      memberships: [
        { data: adminRow, error: null },
        { data: null, count: 1, error: null },
      ],
    });
    const attempt = svc.updateRole(admin, M_ADMIN, { role: 'teacher' });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      'No se puede quitar el rol de administrador al único administrador de la institución',
    );
    expect(state.memberships.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('conteo de admins activos filtra por institución y estados vigentes', async () => {
    const { svc, state } = service({
      memberships: [
        { data: adminRow, error: null },
        { data: null, count: 1, error: null },
      ],
    });
    await expect(
      svc.updateRole(admin, M_ADMIN, { role: 'director' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.memberships.calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
    expect(state.memberships.calls).toContainEqual({
      op: 'eq',
      args: ['role', 'admin'],
    });
    expect(state.memberships.calls).toContainEqual({
      op: 'in',
      args: ['status', ['active', 'activo', 'licencia']],
    });
  });

  it('membresía de otra institución o inexistente → 404', async () => {
    const { svc, state } = service({
      memberships: [{ data: null, error: null }],
    });
    await expect(
      svc.updateRole(admin, M_ADMIN, { role: 'teacher' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(state.memberships.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it.each([
    ['id inválido', 'no-uuid', { role: 'teacher' as const }],
    ['role inválido', M_TEACHER, { role: 'superadmin' as any }],
  ])('%s → 400', async (_n, id, dto) => {
    const { svc } = service({
      memberships: [{ data: teacherRow, error: null }],
    });
    await expect(
      svc.updateRole(admin, id, dto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['director', director],
    [
      'teacher',
      {
        id: 'mT',
        userId: 'uT',
        institutionId: INST,
        role: 'teacher' as const,
      },
    ],
  ])('rol %s → 403 sin consultar la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(
      svc.updateRole(member, M_TEACHER, { role: 'teacher' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(state.memberships?.calls ?? []).toEqual([]);
  });
});

describe('MembershipsService · remove', () => {
  it('aplica baja lógica (status inactive) y retorna void (204)', async () => {
    const { svc, state } = service({
      memberships: [
        { data: teacherRow, error: null },
        { data: null, error: null },
      ],
    });
    await expect(svc.remove(admin, M_TEACHER)).resolves.toBeUndefined();
    const upd = state.memberships.calls.find((c) => c.op === 'update');
    expect(upd?.args[0]).toMatchObject({ status: 'inactive' });
    expect(state.memberships.calls).toContainEqual({
      op: 'eq',
      args: ['institution_id', INST],
    });
  });

  it('eliminar al único admin activo → 409 (caso clave del backlog)', async () => {
    const { svc, state } = service({
      memberships: [
        { data: adminRow, error: null },
        { data: null, count: 1, error: null },
      ],
    });
    const attempt = svc.remove(admin, M_ADMIN);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      'No se puede eliminar al único administrador de la institución',
    );
    expect(state.memberships.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('eliminar admin cuando hay otros → permitido', async () => {
    const { svc, state } = service({
      memberships: [
        { data: adminRow, error: null },
        { data: null, count: 3, error: null },
        { data: null, error: null },
      ],
    });
    await expect(svc.remove(admin, M_ADMIN)).resolves.toBeUndefined();
    expect(state.memberships.calls.some((c) => c.op === 'update')).toBe(true);
  });

  it('membresía de otra institución o inexistente → 404', async () => {
    const { svc, state } = service({
      memberships: [{ data: null, error: null }],
    });
    await expect(svc.remove(admin, M_TEACHER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(state.memberships.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('id inválido → 400', async () => {
    const { svc } = service({});
    await expect(svc.remove(admin, 'no-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rol no admin → 403 sin consultar la base', async () => {
    const { svc, state } = service({});
    await expect(svc.remove(director, M_TEACHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.memberships?.calls ?? []).toEqual([]);
  });
});
