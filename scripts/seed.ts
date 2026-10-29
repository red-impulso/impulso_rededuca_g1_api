/**
 * Seed de demo (B-08): crea la institución "Escuela Demo Perico" con usuarios,
 * membresías, cursos, materias, alumnos, vínculos de tutores y un período de
 * calificación. Es idempotente: limpia los datos de la institución demo antes
 * de recrearlos y reutiliza los usuarios de Supabase Auth ya existentes.
 *
 * Uso: npm run seed
 * Requiere en el entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y
 * SEED_PASSWORD (password asignada a todos los usuarios demo).
 */
import { existsSync } from 'node:fs';
import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SEED_PASSWORD = process.env.SEED_PASSWORD;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SEED_PASSWORD) {
  console.error(
    'Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y/o SEED_PASSWORD en el entorno.',
  );
  process.exit(1);
}

const INSTITUTION_NAME = 'Escuela Demo Perico';
const SCHOOL_YEAR = 2026;

type Role = 'admin' | 'director' | 'teacher' | 'guardian';

interface SeedUser {
  key: string;
  email: string;
  fullName: string;
  role: Role;
}

const USERS: SeedUser[] = [
  { key: 'admin', email: 'admin@demo.rededuca', fullName: 'Admin Demo', role: 'admin' },
  { key: 'teacher1', email: 'docente1@demo.rededuca', fullName: 'Daniela Ríos', role: 'teacher' },
  { key: 'teacher2', email: 'docente2@demo.rededuca', fullName: 'Martín Suárez', role: 'teacher' },
  { key: 'guardian1', email: 'tutor1@demo.rededuca', fullName: 'Laura Benítez', role: 'guardian' },
  { key: 'guardian2', email: 'tutor2@demo.rededuca', fullName: 'Pablo Cárdenas', role: 'guardian' },
  { key: 'guardian3', email: 'tutor3@demo.rededuca', fullName: 'Mariana Duarte', role: 'guardian' },
  { key: 'guardian4', email: 'tutor4@demo.rededuca', fullName: 'Sergio Escudero', role: 'guardian' },
  { key: 'guardian5', email: 'tutor5@demo.rededuca', fullName: 'Florencia Gallo', role: 'guardian' },
  { key: 'guardian6', email: 'tutor6@demo.rededuca', fullName: 'Andrés Herrera', role: 'guardian' },
];

const COURSES = [
  { name: '1.º A', year: 1, division: 'A', shift: 'morning', school_year: SCHOOL_YEAR },
  { name: '2.º A', year: 2, division: 'A', shift: 'morning', school_year: SCHOOL_YEAR },
] as const;

const STUDENTS: { first_name: string; last_name: string; document_number: string }[][] = [
  [
    { first_name: 'Valentina', last_name: 'Acosta', document_number: '62000001' },
    { first_name: 'Benjamín', last_name: 'Álvarez', document_number: '62000002' },
    { first_name: 'Catalina', last_name: 'Bravo', document_number: '62000003' },
    { first_name: 'Dante', last_name: 'Cabrera', document_number: '62000004' },
    { first_name: 'Emma', last_name: 'Castillo', document_number: '62000005' },
    { first_name: 'Facundo', last_name: 'Domínguez', document_number: '62000006' },
    { first_name: 'Guadalupe', last_name: 'Ferreyra', document_number: '62000007' },
    { first_name: 'Bautista', last_name: 'Funes', document_number: '62000008' },
    { first_name: 'Martina', last_name: 'Gallardo', document_number: '62000009' },
    { first_name: 'Thiago', last_name: 'Godoy', document_number: '62000010' },
  ],
  [
    { first_name: 'Sofía', last_name: 'Herrera', document_number: '62000011' },
    { first_name: 'Mateo', last_name: 'Ibáñez', document_number: '62000012' },
    { first_name: 'Julieta', last_name: 'Juárez', document_number: '62000013' },
    { first_name: 'Lautaro', last_name: 'Ledesma', document_number: '62000014' },
    { first_name: 'Camila', last_name: 'Luna', document_number: '62000015' },
    { first_name: 'Ignacio', last_name: 'Maldonado', document_number: '62000016' },
    { first_name: 'Antonella', last_name: 'Molina', document_number: '62000017' },
    { first_name: 'Joaquín', last_name: 'Navarro', document_number: '62000018' },
    { first_name: 'Mía', last_name: 'Ojeda', document_number: '62000019' },
    { first_name: 'Lorenzo', last_name: 'Paredes', document_number: '62000020' },
  ],
];

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function unwrap<T extends { data: unknown; error: { message: string } | null }>(
  result: T,
  ctx: string,
): NonNullable<T['data']> {
  if (result.error) {
    throw new Error(`${ctx}: ${result.error.message}`);
  }
  return result.data as NonNullable<T['data']>;
}

async function ensureInstitution(): Promise<string> {
  const existing = unwrap(
    await db.from('institutions').select('id').eq('name', INSTITUTION_NAME).limit(1),
    'buscar institución',
  );
  if (existing.length) return existing[0].id as string;

  const created = unwrap(
    await db.from('institutions').insert({ name: INSTITUTION_NAME }).select('id').single(),
    'crear institución',
  );
  return created.id as string;
}

/** Borra los datos demo de la institución (subjects y guardian_links caen por cascada). */
async function cleanInstitutionData(institutionId: string): Promise<void> {
  for (const table of ['students', 'courses', 'memberships', 'grading_periods'] as const) {
    unwrap(
      await db.from(table).delete().eq('institution_id', institutionId),
      `limpiar ${table}`,
    );
  }
}

async function listAllAuthUsers(): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
}

/** Crea o reutiliza cada usuario demo y devuelve key → { userId }. */
async function ensureUsers(): Promise<Map<string, string>> {
  const byEmail = new Map(
    (await listAllAuthUsers()).map((u) => [u.email?.toLowerCase() ?? '', u]),
  );
  const ids = new Map<string, string>();

  for (const seed of USERS) {
    let userId: string;
    const existing = byEmail.get(seed.email);
    if (existing) {
      unwrap(
        await db.auth.admin.updateUserById(existing.id, {
          password: SEED_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: seed.fullName },
        }),
        `actualizar ${seed.email}`,
      );
      userId = existing.id;
    } else {
      const created = unwrap(
        await db.auth.admin.createUser({
          email: seed.email,
          password: SEED_PASSWORD,
          email_confirm: true,
          user_metadata: { full_name: seed.fullName },
        }),
        `crear ${seed.email}`,
      );
      if (!created.user) throw new Error(`crear ${seed.email}: respuesta sin usuario`);
      userId = created.user.id;
    }

    unwrap(
      await db
        .from('profiles')
        .upsert({ id: userId, full_name: seed.fullName }, { onConflict: 'id' }),
      `perfil de ${seed.email}`,
    );
    ids.set(seed.key, userId);
  }
  return ids;
}

async function main(): Promise<void> {
  const institutionId = await ensureInstitution();
  console.log(`Institución: ${INSTITUTION_NAME} (${institutionId})`);

  await cleanInstitutionData(institutionId);
  const userIds = await ensureUsers();
  console.log(`Usuarios: ${userIds.size}`);

  unwrap(
    await db.from('memberships').insert(
      USERS.map((u) => ({
        user_id: userIds.get(u.key)!,
        institution_id: institutionId,
        role: u.role,
      })),
    ),
    'crear membresías',
  );

  const memberships = unwrap(
    await db
      .from('memberships')
      .select('id, user_id, role')
      .eq('institution_id', institutionId),
    'leer membresías',
  );
  const membershipIdByUser = new Map(memberships.map((m) => [m.user_id, m.id as string]));

  const courses = unwrap(
    await db
      .from('courses')
      .insert(COURSES.map((c) => ({ ...c, institution_id: institutionId })))
      .select('id, year'),
    'crear cursos',
  );
  const courseIdByYear = new Map(courses.map((c) => [c.year as number, c.id as string]));

  const teachers = [userIds.get('teacher1')!, userIds.get('teacher2')!].map(
    (uid) => membershipIdByUser.get(uid)!,
  );
  unwrap(
    await db.from('subjects').insert([
      { course_id: courseIdByYear.get(1)!, teacher_membership_id: teachers[0], name: 'Matemática' },
      { course_id: courseIdByYear.get(1)!, teacher_membership_id: teachers[1], name: 'Lengua' },
      { course_id: courseIdByYear.get(2)!, teacher_membership_id: teachers[0], name: 'Historia' },
      { course_id: courseIdByYear.get(2)!, teacher_membership_id: teachers[1], name: 'Ciencias Naturales' },
    ]),
    'crear materias',
  );

  const studentRows = STUDENTS.flatMap((list, i) =>
    list.map((s) => ({
      ...s,
      institution_id: institutionId,
      course_id: courseIdByYear.get(i + 1)!,
    })),
  );
  const students = unwrap(
    await db.from('students').insert(studentRows).select('id'),
    'crear alumnos',
  );
  const studentIds = students.map((s) => s.id as string);

  // tutor1 queda con 3 hijos (los 2 primeros de 1.º A y el primero de 2.º A);
  // el resto de los tutores recibe un alumno cada uno.
  const links: [string, number, string][] = [
    ['guardian1', 0, 'madre'],
    ['guardian1', 1, 'madre'],
    ['guardian1', 10, 'madre'],
    ['guardian2', 2, 'padre'],
    ['guardian3', 3, 'madre'],
    ['guardian4', 11, 'padre'],
    ['guardian5', 12, 'madre'],
    ['guardian6', 13, 'padre'],
  ];
  unwrap(
    await db.from('guardian_links').insert(
      links.map(([key, idx, relationship]) => ({
        guardian_membership_id: membershipIdByUser.get(userIds.get(key)!)!,
        student_id: studentIds[idx],
        relationship,
      })),
    ),
    'crear vínculos de tutores',
  );

  unwrap(
    await db.from('grading_periods').insert({
      institution_id: institutionId,
      name: '1.er trimestre',
      starts_on: `${SCHOOL_YEAR}-03-02`,
      ends_on: `${SCHOOL_YEAR}-05-29`,
    }),
    'crear período de calificación',
  );

  console.log('Seed listo: 9 usuarios, 2 cursos, 4 materias, 20 alumnos, 8 vínculos, 1 período.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
