import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { UpdateMembershipRoleDto } from './dto/update-membership-role.dto.js';
import { MembershipsService } from './memberships.service.js';

@Controller('memberships')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Post(':id/reactivate')
  @HttpCode(204)
  reactivate(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.memberships.reactivate(membership, id);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  updateRole(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipRoleDto,
  ) {
    return this.memberships.updateRole(membership, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.memberships.remove(membership, id);
  }
}
