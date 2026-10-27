# impulso_rededuca_g1_api

API (NestJS) de RedEduca.

## Requisitos

- Node.js 22 o superior
- npm

## Instalar

```bash
npm ci
cp .env.example .env
```

## Correr

```bash
npm run start:dev
```

La API queda en `http://localhost:3000`. Verificar con `GET /health` → `200 { "status": "ok" }`.

## Testear

```bash
npm run lint
npm run build
npm test           # unitarios
npm run test:e2e   # end-to-end
```

## CI

GitHub Actions corre lint, build, tests unitarios y e2e en cada pull request (`.github/workflows/ci.yml`).

## Base de datos (Supabase)

El esquema vive en `supabase/migrations/`. Al hacer push a `main`, `.github/workflows/migrate.yml` corre `supabase db push --db-url "$SUPABASE_DB_URL"`. Requiere el secreto `SUPABASE_DB_URL` en el repo.
