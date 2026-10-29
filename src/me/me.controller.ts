import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { CurrentMembership } from '../auth/current-membership.decorator.js';
import {
  MembershipGuard,
  type Membership,
} from '../auth/membership.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { MeService } from './me.service.js';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  getMe(@Req() req: AuthenticatedRequest) {
    return this.meService.getMe(req.user.id);
  }

  @Get('subjects')
  @UseGuards(MembershipGuard)
  @Roles('teacher')
  getMySubjects(@CurrentMembership() membership: Membership) {
    return this.meService.getMySubjects(membership);
  }

  @Get('courses')
  @UseGuards(MembershipGuard)
  @Roles('teacher')
  getMyCourses(@CurrentMembership() membership: Membership) {
    return this.meService.getMyCourses(membership);
  }

  @Get('students')
  @UseGuards(MembershipGuard)
  @Roles('guardian')
  getMyStudents(@CurrentMembership() membership: Membership) {
    return this.meService.getMyStudents(membership);
  }
}
