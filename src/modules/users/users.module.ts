import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [MembershipsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
