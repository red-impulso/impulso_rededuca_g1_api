import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentMembership } from '../../auth/current-membership.decorator.js';
import {
  MembershipGuard,
  type Membership,
} from '../../auth/membership.guard.js';
import { Roles } from '../../auth/roles.decorator.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('counts')
  counts(@CurrentMembership() membership: Membership) {
    return this.users.counts(membership);
  }

  @Get('export')
  exportCsv(
    @CurrentMembership() membership: Membership,
    @Query('format') format?: string,
    @Query('membershipIds') membershipIds?: string,
  ) {
    if (format && format !== 'csv') {
      throw new BadRequestException("format debe ser 'csv'");
    }
    return this.users.exportCsv(
      membership,
      membershipIds
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  @Get()
  list(
    @CurrentMembership() membership: Membership,
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('lastAccess') lastAccess?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit = 25,
  ) {
    return this.users.list(membership, {
      q,
      role,
      status,
      lastAccess,
      page,
      limit,
    });
  }

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateUserDto,
  ) {
    return this.users.create(membership, dto);
  }

  @Patch(':userId')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(membership, userId, dto);
  }

  @Post(':userId/reset-password')
  @HttpCode(204)
  resetPassword(
    @CurrentMembership() membership: Membership,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.users.resetPassword(membership, userId);
  }
}
