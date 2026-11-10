import {
  Body,
  Controller,
  Patch,
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
import { UpdateInstitutionDto } from './dto/update-institution.dto.js';
import { InstitutionService } from './institution.service.js';

@Controller('institution')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class InstitutionController {
  constructor(private readonly institution: InstitutionService) {}

  @Patch()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Body() dto: UpdateInstitutionDto,
  ) {
    return this.institution.update(membership, dto);
  }
}
