import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import { InstitutionService } from './institution.service.js';

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
        update: (...args: unknown[]) => (
          table.calls.push({ op: 'update', args }), q
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
  const svc = new InstitutionService({ admin: db } as any);
  return { svc, state };
}

const INST = '11111111-2222-3333-4444-555555555555';

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

const institutionRow = {
  id: INST,
  name: 'Colegio San Martín',
  address: 'Av. Siempre Viva 742',
  levels: ['Primario', 'Secundario'],
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('InstitutionService · update', () => {
  it('actualiza name, address y levels filtrando por la institución activa', async () => {
    const { svc, state } = service({
      institutions: [{ data: institutionRow, error: null }],
    });
    await expect(
      svc.update(admin, {
        name: ' Colegio San Martín ',
        address: 'Av. Siempre Viva 742',
        levels: ['Primario', 'Secundario'],
      }),
    ).resolves.toEqual({
      id: INST,
      name: 'Colegio San Martín',
      address: 'Av. Siempre Viva 742',
      levels: ['Primario', 'Secundario'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(state.institutions.calls).toContainEqual({
      op: 'eq',
      args: ['id', INST],
    });
    expect(
      state.institutions.calls.find((c) => c.op === 'update')?.args[0],
    ).toEqual({
      name: 'Colegio San Martín',
      address: 'Av. Siempre Viva 742',
      levels: ['Primario', 'Secundario'],
    });
  });

  it('admin y director → actualizan', async () => {
    for (const member of [admin, director]) {
      const { svc } = service({
        institutions: [{ data: institutionRow, error: null }],
      });
      await expect(
        svc.update(member, { name: 'Colegio San Martín' }),
      ).resolves.toMatchObject({ id: INST });
    }
  });

  it('teacher y guardian → 403 sin tocar la base', async () => {
    for (const member of [teacher, guardian]) {
      const { svc, state } = service({});
      await expect(
        svc.update(member, { name: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(state.institutions?.calls ?? []).toEqual([]);
    }
  });

  it('address vacío → se guarda null', async () => {
    const { svc, state } = service({
      institutions: [
        { data: { ...institutionRow, address: null }, error: null },
      ],
    });
    await svc.update(admin, { address: '   ' });
    expect(
      state.institutions.calls.find((c) => c.op === 'update')?.args[0],
    ).toEqual({ address: null });
  });

  it('levels con vacíos → se limpian antes de guardar', async () => {
    const { svc, state } = service({
      institutions: [{ data: institutionRow, error: null }],
    });
    await svc.update(admin, { levels: [' Primario ', '', 'Secundario'] });
    expect(
      state.institutions.calls.find((c) => c.op === 'update')?.args[0],
    ).toEqual({ levels: ['Primario', 'Secundario'] });
  });

  it('name vacío → 400 y no escribe', async () => {
    const { svc, state } = service({});
    await expect(svc.update(admin, { name: '  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.institutions?.calls ?? []).toEqual([]);
  });

  it('levels que no es arreglo → 400', async () => {
    const { svc } = service({});
    await expect(
      svc.update(admin, { levels: 'Primario' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dto vacío → 400', async () => {
    const { svc, state } = service({});
    await expect(svc.update(admin, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.institutions?.calls ?? []).toEqual([]);
  });
});
