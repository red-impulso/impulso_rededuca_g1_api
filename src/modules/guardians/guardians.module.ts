import { Module } from '@nestjs/common';
import {
  GuardiansAdminController,
  GuardiansController,
} from './guardians.controller.js';
import { GuardiansService } from './guardians.service.js';

@Module({
  controllers: [GuardiansController, GuardiansAdminController],
  providers: [GuardiansService],
})
export class GuardiansModule {}
