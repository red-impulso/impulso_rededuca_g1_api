import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
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
import { CreateGuardianLinkDto } from './dto/create-guardian-link.dto.js';
import { CreateGuardianDto } from './dto/create-guardian.dto.js';
import { UpdateGuardianLinkDto } from './dto/update-guardian-link.dto.js';
import { UpdateGuardianDto } from './dto/update-guardian.dto.js';
import { GuardiansService } from './guardians.service.js';

@Controller('students')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get(':id/guardians')
  list(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.guardians.list(membership, id, includeInactive === 'true');
  }

  @Post(':id/guardians')
  @HttpCode(201)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  link(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGuardianLinkDto,
  ) {
    return this.guardians.link(membership, id, dto);
  }

  @Patch(':id/guardians/:guardianMembershipId')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianMembershipId', ParseUUIDPipe) guardianMembershipId: string,
    @Body() dto: UpdateGuardianLinkDto,
  ) {
    return this.guardians.update(membership, id, guardianMembershipId, dto);
  }

  @Delete(':id/guardians/:guardianMembershipId')
  @HttpCode(204)
  unlink(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianMembershipId', ParseUUIDPipe) guardianMembershipId: string,
  ) {
    return this.guardians.unlink(membership, id, guardianMembershipId);
  }

  @Post(':id/guardians/:guardianMembershipId/make-primary')
  makePrimary(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianMembershipId', ParseUUIDPipe) guardianMembershipId: string,
  ) {
    return this.guardians.makePrimary(membership, id, guardianMembershipId);
  }
}

@Controller('guardians')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class GuardiansAdminController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  list(
    @CurrentMembership() membership: Membership,
    @Query('q') q?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit = 25,
  ) {
    return this.guardians.search(membership, { q, page, limit });
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateGuardianDto,
  ) {
    return this.guardians.createGuardian(membership, dto);
  }

  @Patch(':membershipId')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateGuardianDto,
  ) {
    return this.guardians.updateGuardian(membership, membershipId, dto);
  }
}
