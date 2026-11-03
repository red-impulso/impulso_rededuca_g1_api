import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentMembership } from '../../auth/current-membership.decorator.js';
import {
  MembershipGuard,
  type Membership,
} from '../../auth/membership.guard.js';
import { Roles } from '../../auth/roles.decorator.js';
import type { SaveGradesDto } from './dto/save-grades.dto.js';
import { GradesService } from './grades.service.js';

@Controller('grading-periods')
@UseGuards(AuthGuard, MembershipGuard)
export class GradingPeriodsController {
  constructor(private readonly grades: GradesService) {}

  @Get()
  list(@CurrentMembership() membership: Membership) {
    return this.grades.listPeriods(membership);
  }
}

@Controller('grades')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director', 'teacher')
export class GradesController {
  constructor(private readonly grades: GradesService) {}

  @Get()
  sheet(
    @CurrentMembership() membership: Membership,
    @Query('subjectId') subjectId: string,
    @Query('periodId') periodId: string,
  ) {
    return this.grades.getSheet(membership, subjectId, periodId);
  }

  @Put()
  save(
    @CurrentMembership() membership: Membership,
    @Body() dto: SaveGradesDto,
  ) {
    return this.grades.saveSheet(membership, dto);
  }
}

@Controller('students')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director', 'teacher', 'guardian')
export class StudentsController {
  constructor(private readonly grades: GradesService) {}

  @Get(':studentId/grades')
  studentGrades(
    @CurrentMembership() membership: Membership,
    @Param('studentId') studentId: string,
  ) {
    return this.grades.getStudentGrades(membership, studentId);
  }
}
