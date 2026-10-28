import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { HealthController } from './health/health.controller.js';
import { MeModule } from './me/me.module.js';
import { SupabaseModule } from './supabase/supabase.module.js';

@Module({
  imports: [EventEmitterModule.forRoot(), SupabaseModule, MeModule],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
