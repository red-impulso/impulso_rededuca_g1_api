import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { SupabaseService } from './../src/supabase/supabase.service.js';

const getUser = vi.fn(async (token: string) =>
  token === 'bueno'
    ? { data: { user: { id: 'u1', email: 'a@b.c' } }, error: null }
    : { data: { user: null }, error: new Error('invalid') },
);

function chain(result: unknown) {
  const q: any = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve(result),
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return q;
}

const tables: Record<string, unknown> = {
  profiles: {
    data: { id: 'u1', full_name: 'Ana Pérez', phone: null },
    error: null,
  },
  memberships: {
    data: [
      {
        id: 'm1',
        institution_id: 'i1',
        role: 'admin',
        institutions: { name: 'Escuela 1' },
      },
    ],
    error: null,
  },
};

describe('GET /me (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue({
        admin: {
          auth: { getUser },
          from: (t: string) => chain(tables[t]),
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sin header → 401', () =>
    request(app.getHttpServer()).get('/me').expect(401));

  it('token inválido → 401', () =>
    request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer malo')
      .expect(401));

  it('token válido → perfil y membresías', () =>
    request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer bueno')
      .expect(200)
      .expect({
        profile: { id: 'u1', fullName: 'Ana Pérez', phone: null },
        memberships: [
          {
            id: 'm1',
            institutionId: 'i1',
            institutionName: 'Escuela 1',
            role: 'admin',
          },
        ],
      }));

  it('/health sigue público', () =>
    request(app.getHttpServer()).get('/health').expect(200));
});
