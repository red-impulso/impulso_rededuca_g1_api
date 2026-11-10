import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { GuardiansService } from './guardians.service.js';

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
        neq: (...args: unknown[]) => (
          table.calls.push({ op: 'neq', args }), q
        ),
        in: (...args: unknown[]) => (
          table.calls.push({ op: 'in', args }), q
        ),
        not: (...args: unknown[]) => (
          table.calls.push({ op: 'not', args }), q
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
  const svc = new GuardiansService({ admin: db } as any);
  return { svc, state, getUserById };
}

const INST = '11111111-2222-3333-4444-555555555555';
const ST1 = 'cccccccc-0000-0000-0000-000000000001';
const GM1 = 'eeeeeeee-0000-0000-0000-0000000000a1';
const GM2 = 'eeeeeeee-0000-0000-0000-0000000000a2';

const admin: Membership = {
  id: 'mA',
  userId: 'uA',
  institutionId: INST,
  role: 'admin',
};

const studentRow = { id: ST1 };
const guardianMembershipRow = { id: GM1, role: 'guardian' };

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    student_id: ST1,
    guardian_membership_id: GM1,
    relationship: 'madre',
    is_primary: false,
    is_emergency_contact: false,
    is_financial_responsible: false,
    status: 'active',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    ...overrides,
  };
}

const profileRow = {
  id: 'uG1',
  full_name: 'María García',
  first_name: 'María',
  last_name: 'García',
  dni: '30111222',
  phone: '1144556677',
  address: 'Calle Falsa 123',
};

/** Cola estándar para enriquecer un vínculo con un tutor. */
function enrichQueue(membershipId = GM1, userId = 'uG1') {
  return {
    memberships: [
      { data: [{ id: membershipId, user_id: userId }], error: null },
    ],
    profiles: [{ data: [profileRow], error: null }],
  };
}

describe('GuardiansService · acceso', () => {
  it.each(['teacher', 'guardian'])(
    'rol %s → 403 sin consultar la base',
    async (role) => {
      const member = { ...admin, role } as Membership;
      const { svc, state } = service({});
      await expect(svc.list(member, ST1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        svc.link(member, ST1, { guardianMembershipId: GM1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.unlink(member, ST1, GM1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(state.students?.calls ?? []).toEqual([]);
    },
  );
});

describe('GuardiansService · list', () => {
  it('404 si el alumno no existe en la institución', async () => {
    const { svc } = service({
      students: [{ data: null, error: null }],
    });
    await expect(svc.list(admin, ST1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('devuelve la lista ordenada y enriquecida con perfil, email y otros alumnos', async () => {
    const { svc, state } = service(
      {
        students: [{ data: studentRow, error: null }],
        guardian_links: [
          {
            data: [
              linkRow({ id: 'l2', guardian_membership_id: GM2 }),
              linkRow({ id: 'l1', is_primary: true }),
            ],
            error: null,
          },
          {
            data: [
              { guardian_membership_id: GM1 },
              { guardian_membership_id: GM1 },
            ],
            error: null,
          },
        ],
        memberships: [
          {
            data: [
              { id: GM1, user_id: 'uG1' },
              { id: GM2, user_id: 'uG2' },
            ],
            error: null,
          },
        ],
        profiles: [
          {
            data: [
              profileRow,
              { ...profileRow, id: 'uG2', full_name: 'Juan Pérez' },
            ],
            error: null,
          },
        ],
      },
      { uG1: 'maria@mail.com' },
    );

    const result = await svc.list(admin, ST1);

    expect(result.total).toBe(2);
    const [first] = result.data;
    expect(first).toMatchObject({
      guardianMembershipId: GM2,
      relationship: 'madre',
      isPrimary: false,
      status: 'active',
      otherStudentsCount: 0,
    });
    const primary = result.data[1];
    expect(primary).toMatchObject({
      guardianMembershipId: GM1,
      isPrimary: true,
      email: 'maria@mail.com',
      otherStudentsCount: 2,
      profile: {
        id: 'uG1',
        fullName: 'María García',
        firstName: 'María',
        lastName: 'García',
        dni: '30111222',
        phone: '1144556677',
        address: 'Calle Falsa 123',
      },
    });

    const orders = state.guardian_links.calls
      .filter((c) => c.op === 'order')
      .map((c) => c.args);
    expect(orders).toEqual([
      ['is_primary', { ascending: false }],
      ['status'],
      ['created_at'],
    ]);
    expect(state.guardian_links.calls).toContainEqual({
      op: 'neq',
      args: ['status', 'inactive'],
    });
  });

  it('includeInactive=true no filtra por estado', async () => {
    const { svc, state } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [
        { data: [linkRow({ status: 'inactive' })], error: null },
        { data: [], error: null },
      ],
      ...enrichQueue(),
    });

    const result = await svc.list(admin, ST1, true);
    expect(result.total).toBe(1);
    expect(
      state.guardian_links.calls.filter(
        (c) => c.op === 'neq' && c.args[0] === 'status',
      ),
    ).toEqual([]);
  });
});

describe('GuardiansService · link', () => {
  const dto = { guardianMembershipId: GM1, relationship: 'padre' as const };

  it('409 si ya existe un vínculo activo (caso backlog)', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      memberships: [
        { data: guardianMembershipRow, error: null },
        { data: [{ id: GM1, user_id: 'uG1' }], error: null },
      ],
      guardian_links: [
        { data: linkRow(), error: null },
      ],
    });
    await expect(svc.link(admin, ST1, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('400 si la membresía no tiene rol guardian', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      memberships: [{ data: { id: GM1, role: 'teacher' }, error: null }],
    });
    const err = await svc.link(admin, ST1, dto).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain(
      'La membresía asignada debe tener rol de tutor/familiar',
    );
  });

  it('400 si la membresía no existe en la institución', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      memberships: [{ data: null, error: null }],
    });
    await expect(svc.link(admin, ST1, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('el primer tutor activo queda como principal automáticamente', async () => {
    const created = linkRow({ is_primary: true, relationship: 'padre' });
    const { svc, state } = service(
      {
        students: [{ data: studentRow, error: null }],
        memberships: [
          { data: guardianMembershipRow, error: null },
          { data: [{ id: GM1, user_id: 'uG1' }], error: null },
        ],
        guardian_links: [
          { data: null, error: null }, // no existe vínculo
          { data: [], error: null }, // no hay activos
          { data: null, error: null }, // clearPrimary
          { data: created, error: null }, // insert().single()
          { data: [], error: null }, // otherStudentsCount
        ],
        profiles: [{ data: [profileRow], error: null }],
      },
      { uG1: 'maria@mail.com' },
    );

    const result = await svc.link(admin, ST1, {
      guardianMembershipId: GM1,
      relationship: 'padre',
    });

    const inserts = state.guardian_links.calls
      .filter((c) => c.op === 'insert')
      .map((c) => c.args[0] as any);
    expect(inserts[0]).toMatchObject({
      student_id: ST1,
      guardian_membership_id: GM1,
      relationship: 'padre',
      is_primary: true,
      status: 'active',
    });
    expect(result.isPrimary).toBe(true);
    expect(result.email).toBe('maria@mail.com');
  });

  it('isPrimary=true desmarca al principal previo', async () => {
    const created = linkRow({ is_primary: true });
    const { svc, state } = service(
      {
        students: [{ data: studentRow, error: null }],
        memberships: [
          { data: guardianMembershipRow, error: null },
          { data: [{ id: GM1, user_id: 'uG1' }], error: null },
        ],
        guardian_links: [
          { data: null, error: null },
          { data: [{ id: 'other-link' }], error: null }, // ya hay activos
          { data: null, error: null }, // clearPrimary
          { data: created, error: null }, // insert
          { data: [], error: null },
        ],
        profiles: [{ data: [profileRow], error: null }],
      },
      { uG1: 'maria@mail.com' },
    );

    await svc.link(admin, ST1, { guardianMembershipId: GM1, isPrimary: true });

    const updates = state.guardian_links.calls
      .filter((c) => c.op === 'update')
      .map((c) => c.args[0]);
    expect(updates).toContainEqual({ is_primary: false });
  });

  it('reactiva un vínculo inactivo en lugar de duplicarlo', async () => {
    const reactivated = linkRow({ status: 'active' });
    const { svc, state } = service(
      {
        students: [{ data: studentRow, error: null }],
        memberships: [
          { data: guardianMembershipRow, error: null },
          { data: [{ id: GM1, user_id: 'uG1' }], error: null },
        ],
        guardian_links: [
          { data: linkRow({ status: 'inactive' }), error: null },
          { data: [], error: null }, // activos
          { data: null, error: null }, // clearPrimary (primer activo)
          { data: reactivated, error: null }, // update().single()
          { data: [], error: null },
        ],
        profiles: [{ data: [profileRow], error: null }],
      },
      { uG1: 'maria@mail.com' },
    );

    const result = await svc.link(admin, ST1, dto);
    expect(result.status).toBe('active');
    expect(
      state.guardian_links.calls.filter((c) => c.op === 'insert'),
    ).toEqual([]);
    const updates = state.guardian_links.calls
      .filter((c) => c.op === 'update')
      .map((c) => c.args[0] as any);
    expect(updates).toContainEqual(
      expect.objectContaining({ status: 'active', is_primary: true }),
    );
  });
});

describe('GuardiansService · update', () => {
  it('404 si el vínculo no existe', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [{ data: null, error: null }],
    });
    await expect(
      svc.update(admin, ST1, GM1, { relationship: 'otro' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si no se envía ningún campo', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [{ data: linkRow(), error: null }],
    });
    await expect(svc.update(admin, ST1, GM1, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('isPrimary=true desmarca al principal previo y actualiza el vínculo', async () => {
    const updated = linkRow({ is_primary: true });
    const { svc, state } = service(
      {
        students: [{ data: studentRow, error: null }],
        guardian_links: [
          { data: linkRow(), error: null }, // linkFor
          { data: null, error: null }, // clearPrimary
          { data: updated, error: null }, // update().single()
          { data: [], error: null }, // otherStudentsCount
        ],
        ...enrichQueue(),
      },
      { uG1: 'maria@mail.com' },
    );

    const result = await svc.update(admin, ST1, GM1, { isPrimary: true });
    expect(result.isPrimary).toBe(true);

    const updates = state.guardian_links.calls
      .filter((c) => c.op === 'update')
      .map((c) => c.args[0] as any);
    expect(updates[0]).toEqual({ is_primary: false });
    expect(updates[1]).toEqual(
      expect.objectContaining({ is_primary: true }),
    );
  });
});

describe('GuardiansService · unlink', () => {
  it('400 al desvincular al principal con otros tutores activos', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [
        { data: linkRow({ is_primary: true }), error: null },
        { data: [{ id: 'other-active' }], error: null },
      ],
    });
    const err = await svc.unlink(admin, ST1, GM1).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain(
      'No se puede desvincular al único tutor principal',
    );
  });

  it('baja lógica: status inactive y sin marcar como principal', async () => {
    const { svc, state } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [
        { data: linkRow({ is_primary: true }), error: null },
        { data: [], error: null }, // no quedan otros activos
        { data: null, error: null }, // update de baja
      ],
    });

    await expect(svc.unlink(admin, ST1, GM1)).resolves.toBeUndefined();

    const updates = state.guardian_links.calls
      .filter((c) => c.op === 'update')
      .map((c) => c.args[0] as any);
    expect(updates[0]).toEqual(
      expect.objectContaining({ status: 'inactive', is_primary: false }),
    );
  });

  it('permite desvincular a un tutor no principal', async () => {
    const { svc, state } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [
        { data: linkRow({ is_primary: false }), error: null },
        { data: null, error: null },
      ],
    });
    await expect(svc.unlink(admin, ST1, GM1)).resolves.toBeUndefined();
    const updates = state.guardian_links.calls
      .filter((c) => c.op === 'update')
      .map((c) => c.args[0] as any);
    expect(updates[0]).toEqual(
      expect.objectContaining({ status: 'inactive' }),
    );
  });
});

describe('GuardiansService · makePrimary', () => {
  it('desmarca al principal previo y marca el nuevo', async () => {
    const promoted = linkRow({ is_primary: true });
    const { svc, state } = service(
      {
        students: [{ data: studentRow, error: null }],
        guardian_links: [
          { data: linkRow(), error: null }, // linkFor
          { data: null, error: null }, // clearPrimary
          { data: promoted, error: null }, // update().single()
          { data: [], error: null },
        ],
        ...enrichQueue(),
      },
      { uG1: 'maria@mail.com' },
    );

    const result = await svc.makePrimary(admin, ST1, GM1);
    expect(result.isPrimary).toBe(true);

    const updates = state.guardian_links.calls
      .filter((c) => c.op === 'update')
      .map((c) => c.args[0] as any);
    expect(updates[0]).toEqual({ is_primary: false });
    expect(updates[1]).toEqual(
      expect.objectContaining({ is_primary: true }),
    );
  });

  it('400 si el vínculo está inactivo', async () => {
    const { svc } = service({
      students: [{ data: studentRow, error: null }],
      guardian_links: [
        { data: linkRow({ status: 'inactive' }), error: null },
      ],
    });
    await expect(svc.makePrimary(admin, ST1, GM1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
