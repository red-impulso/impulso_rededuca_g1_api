import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MeService } from './me.service.js';

function chain(result: unknown) {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve(result),
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return q;
}

function service(tables: Record<string, unknown>) {
  return new MeService({
    admin: { from: (t: string) => chain(tables[t]) },
  } as any);
}

describe('MeService', () => {
  it('devuelve perfil y membresías', async () => {
    const svc = service({
      profiles: {
        data: { id: 'u1', full_name: 'Ana Pérez', phone: '+54 11 1234' },
        error: null,
      },
      memberships: {
        data: [
          {
            id: 'm1',
            institution_id: 'i1',
            role: 'teacher',
            institutions: { name: 'Escuela 1' },
          },
        ],
        error: null,
      },
    });
    await expect(svc.getMe('u1')).resolves.toEqual({
      profile: { id: 'u1', fullName: 'Ana Pérez', phone: '+54 11 1234' },
      memberships: [
        {
          id: 'm1',
          institutionId: 'i1',
          institutionName: 'Escuela 1',
          role: 'teacher',
        },
      ],
    });
  });

  it('sin perfil → 404', async () => {
    const svc = service({
      profiles: { data: null, error: null },
      memberships: { data: [], error: null },
    });
    await expect(svc.getMe('u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
