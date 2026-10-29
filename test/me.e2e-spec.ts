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

  describe('endpoints por rol (B-07)', () => {
    const INST = '11111111-2222-3333-4444-555555555555';
    const row = (id: string, role: string) => ({
      id,
      user_id: 'u1',
      institution_id: INST,
      role,
    });
    const auth = (r: request.Test) =>
      r.set('Authorization', 'Bearer bueno').set('X-Institution-Id', INST);
    const backup = { ...tables };

    afterEach(() => {
      for (const k of Object.keys(tables)) delete tables[k];
      Object.assign(tables, backup);
    });

    it('docente → GET /me/subjects devuelve sus materias', () => {
      tables.memberships = { data: [row('mT', 'teacher')], error: null };
      tables.subjects = {
        data: [
          {
            id: 's1',
            name: 'Matemática',
            courses: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
          },
        ],
        error: null,
      };
      return auth(request(app.getHttpServer()).get('/me/subjects'))
        .expect(200)
        .expect([
          {
            id: 's1',
            name: 'Matemática',
            course: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
          },
        ]);
    });

    it('docente → GET /me/courses devuelve cursos únicos', () => {
      tables.memberships = { data: [row('mT', 'teacher')], error: null };
      tables.subjects = {
        data: [
          {
            id: 's1',
            name: 'Matemática',
            courses: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
          },
          {
            id: 's2',
            name: 'Física',
            courses: { id: 'c1', year: 5, division: 'A', shift: 'morning' },
          },
        ],
        error: null,
      };
      return auth(request(app.getHttpServer()).get('/me/courses'))
        .expect(200)
        .expect([{ id: 'c1', year: 5, division: 'A', shift: 'morning' }]);
    });

    it('tutor → GET /me/students devuelve sus hijos', () => {
      tables.memberships = { data: [row('mG', 'guardian')], error: null };
      tables.guardian_links = {
        data: [
          {
            students: {
              id: 'st1',
              first_name: 'Juana',
              last_name: 'Pérez',
              courses: { id: 'c1', year: 3, division: 'B' },
            },
          },
        ],
        error: null,
      };
      return auth(request(app.getHttpServer()).get('/me/students'))
        .expect(200)
        .expect([
          {
            id: 'st1',
            firstName: 'Juana',
            lastName: 'Pérez',
            course: { id: 'c1', year: 3, division: 'B' },
          },
        ]);
    });

    it('tutor → GET /me/subjects y /me/courses → 403', async () => {
      tables.memberships = { data: [row('mG', 'guardian')], error: null };
      await auth(request(app.getHttpServer()).get('/me/subjects')).expect(403);
      await auth(request(app.getHttpServer()).get('/me/courses')).expect(403);
    });

    it('docente → GET /me/students → 403', () => {
      tables.memberships = { data: [row('mT', 'teacher')], error: null };
      return auth(request(app.getHttpServer()).get('/me/students')).expect(403);
    });

    it('admin/director → rutas de docente y tutor → 403', async () => {
      tables.memberships = { data: [row('mA', 'admin')], error: null };
      await auth(request(app.getHttpServer()).get('/me/subjects')).expect(403);
      await auth(request(app.getHttpServer()).get('/me/courses')).expect(403);
      await auth(request(app.getHttpServer()).get('/me/students')).expect(403);
      tables.memberships = { data: [row('mD', 'director')], error: null };
      await auth(request(app.getHttpServer()).get('/me/students')).expect(403);
    });

    it('sin X-Institution-Id → 400', () => {
      tables.memberships = { data: [row('mT', 'teacher')], error: null };
      return request(app.getHttpServer())
        .get('/me/subjects')
        .set('Authorization', 'Bearer bueno')
        .expect(400);
    });
  });
});
