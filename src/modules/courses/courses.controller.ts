import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentMembership } from '../../auth/current-membership.decorator.js';
import {
  MembershipGuard,
  type Membership,
} from '../../auth/membership.guard.js';
import { Roles } from '../../auth/roles.decorator.js';
import { CoursesService } from './courses.service.js';

@Controller('courses')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list(@CurrentMembership() membership: Membership) {
    return this.courses.list(membership);
  }
}
