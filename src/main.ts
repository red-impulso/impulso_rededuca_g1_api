import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Confía en el primer proxy (Vercel/Supabase) para que req.ip sea la IP real
  // del cliente; ThrottlerGuard la usa como tracker del rate limit.
  app.set('trust proxy', 1);

  const allowedOrigins = [
    'http://localhost:3000',
    'https://redimpulso-g1.vercel.app',
    'https://red-impulso-grupo1.vercel.app',
    process.env.FRONTEND_URL,
  ].filter((o): o is string => Boolean(o));

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
