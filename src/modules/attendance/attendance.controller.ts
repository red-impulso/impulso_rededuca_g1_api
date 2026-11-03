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
import type { SaveAttendanceDto } from './dto/save-attendance.dto.js';
import { AttendanceService } from './attendance.service.js';

@Controller('attendance')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director', 'teacher')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  sheet(
    @CurrentMembership() membership: Membership,
    @Query('courseId') courseId: string,
    @Query('date') date: string,
  ) {
    return this.attendance.getSheet(membership, courseId, date);
  }

  @Put()
  save(
    @CurrentMembership() membership: Membership,
    @Body() dto: SaveAttendanceDto,
  ) {
    return this.attendance.saveSheet(membership, dto);
  }
}

@Controller('students')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director', 'teacher', 'guardian')
export class StudentAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get(':studentId/attendance')
  studentAttendance(
    @CurrentMembership() membership: Membership,
    @Param('studentId') studentId: string,
  ) {
    return this.attendance.getStudentAttendance(membership, studentId);
  }
}
