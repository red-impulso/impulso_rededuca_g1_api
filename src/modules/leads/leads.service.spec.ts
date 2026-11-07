import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { CreateLeadDto } from './dto/create-lead.dto.js';
import { LeadsService } from './leads.service.js';

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
      const next = () => table.results.shift() ?? { data: null, error: null };
      const q: any = {
        select: (...args: unknown[]) => (
          table.calls.push({ op: 'select', args }),
          q
        ),
        eq: (...args: unknown[]) => (table.calls.push({ op: 'eq', args }), q),
        in: (...args: unknown[]) => (table.calls.push({ op: 'in', args }), q),
        not: (...args: unknown[]) => (table.calls.push({ op: 'not', args }), q),
        limit: (...args: unknown[]) => (
          table.calls.push({ op: 'limit', args }),
          q
        ),
        order: (...args: unknown[]) => (
          table.calls.push({ op: 'order', args }),
          q
        ),
        upsert: (...args: unknown[]) => (
          table.calls.push({ op: 'upsert', args }),
          q
        ),
        insert: (...args: unknown[]) => (
          table.calls.push({ op: 'insert', args }),
          q
        ),
        update: (...args: unknown[]) => (
          table.calls.push({ op: 'update', args }),
          q
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
  const svc = new LeadsService({ admin: db } as any);
  return { svc, state };
}

const LEAD_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

const validDto = (over: Record<string, unknown> = {}): CreateLeadDto =>
  ({
    institutionName: 'Colegio San Martín',
    contactName: 'María Pérez',
    city: 'Rosario',
    contactRole: 'Directora',
    level: 'Primario',
    contactChannel: 'maria@colegio.edu.ar',
    studentCount: 450,
    comment: 'Quieren una demo',
    privacyAccepted: true,
    ...over,
  }) as CreateLeadDto;

const leadRow = {
  id: LEAD_ID,
  institution_name: 'Colegio San Martín',
  contact_name: 'María Pérez',
  city: 'Rosario',
  contact_role: 'Directora',
  level: 'Primario',
  contact_channel: 'maria@colegio.edu.ar',
  student_count: 450,
  comment: 'Quieren una demo',
  status: 'new',
  created_at: '2026-11-07T10:00:00Z',
};

describe('LeadsService · create', () => {
  it('persiste el lead mapeando a snake_case y devuelve { id }', async () => {
    const { svc, state } = service({
      leads: [{ data: { id: LEAD_ID }, error: null }],
    });

    await expect(svc.create(validDto())).resolves.toEqual({ id: LEAD_ID });

    const inserts = state.leads.calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toEqual({
      institution_name: 'Colegio San Martín',
      contact_name: 'María Pérez',
      city: 'Rosario',
      contact_role: 'Directora',
      level: 'Primario',
      contact_channel: 'maria@colegio.edu.ar',
      student_count: 450,
      comment: 'Quieren una demo',
      privacy_accepted_at: expect.any(String),
    });
  });

  it('comment vacío se persiste como null', async () => {
    const { svc, state } = service({
      leads: [{ data: { id: LEAD_ID }, error: null }],
    });
    await svc.create(validDto({ comment: '   ' }));
    expect(state.leads.calls[0].args[0]).toMatchObject({ comment: null });
  });

  it('privacyAccepted false o ausente → 400 sin escribir', async () => {
    for (const privacyAccepted of [false, undefined]) {
      const { svc, state } = service({});
      await expect(
        svc.create(validDto({ privacyAccepted })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(state.leads?.calls ?? []).toEqual([]);
    }
  });
});

describe('LeadsService · list', () => {
  const rows = [
    leadRow,
    {
      ...leadRow,
      id: 'bbbbbbbb-1111-2222-3333-444444444444',
      status: 'contacted',
    },
  ];

  it('devuelve leads en camelCase ordenados del más nuevo al más viejo', async () => {
    const { svc, state } = service({
      leads: [{ data: rows, error: null }],
    });

    const result = await svc.list();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: LEAD_ID,
      institutionName: 'Colegio San Martín',
      contactName: 'María Pérez',
      city: 'Rosario',
      contactRole: 'Directora',
      level: 'Primario',
      contactChannel: 'maria@colegio.edu.ar',
      studentCount: 450,
      comment: 'Quieren una demo',
      status: 'new',
      createdAt: '2026-11-07T10:00:00Z',
    });
    expect(
      state.leads.calls.some(
        (c) =>
          c.op === 'order' &&
          c.args[0] === 'created_at' &&
          (c.args[1] as any)?.ascending === false,
      ),
    ).toBe(true);
    // sin status no filtra
    expect(state.leads.calls.some((c) => c.op === 'eq')).toBe(false);
  });

  it('con status=new filtra por eq', async () => {
    const { svc, state } = service({
      leads: [{ data: [leadRow], error: null }],
    });
    await svc.list('new');
    expect(
      state.leads.calls.some(
        (c) => c.op === 'eq' && c.args[0] === 'status' && c.args[1] === 'new',
      ),
    ).toBe(true);
  });

  it('status inválido → 400 sin consultar la base', async () => {
    const { svc, state } = service({});
    await expect(svc.list('archived')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.leads?.calls ?? []).toEqual([]);
  });

  it('sin leads → lista vacía', async () => {
    const { svc } = service({ leads: [{ data: [], error: null }] });
    await expect(svc.list()).resolves.toEqual([]);
  });
});

describe('LeadsService · updateStatus', () => {
  it('actualiza el estado y devuelve el lead en camelCase', async () => {
    const updated = { ...leadRow, status: 'contacted' };
    const { svc, state } = service({
      leads: [{ data: updated, error: null }],
    });

    const result = await svc.updateStatus(LEAD_ID, { status: 'contacted' });

    expect(result.status).toBe('contacted');
    expect(result.id).toBe(LEAD_ID);
    expect(
      state.leads.calls.some(
        (c) => c.op === 'update' && (c.args[0] as any).status === 'contacted',
      ),
    ).toBe(true);
    expect(
      state.leads.calls.some(
        (c) => c.op === 'eq' && c.args[0] === 'id' && c.args[1] === LEAD_ID,
      ),
    ).toBe(true);
  });

  it('id inexistente → 404', async () => {
    const { svc } = service({ leads: [{ data: null, error: null }] });
    await expect(
      svc.updateStatus(LEAD_ID, { status: 'discarded' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('status inválido → 400 sin escribir', async () => {
    const { svc, state } = service({});
    await expect(
      svc.updateStatus(LEAD_ID, { status: 'pending' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.leads?.calls ?? []).toEqual([]);
  });
});
