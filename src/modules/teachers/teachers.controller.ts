import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Put,
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
import { AssignTeacherDto } from './dto/assign-teacher.dto.js';
import { UpdateTeacherDto } from './dto/update-teacher.dto.js';
import { TeachersService } from './teachers.service.js';

@Controller('teachers')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Get()
  list(
    @CurrentMembership() membership: Membership,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('employmentStatus') employmentStatus?: string,
    @Query('courseId') courseId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit = 25,
  ) {
    return this.teachers.list(membership, {
      q,
      status,
      employmentStatus,
      courseId,
      subjectId,
      page,
      limit,
    });
  }

  @Get(':id')
  detail(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.teachers.detail(membership, id);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.teachers.update(membership, id, dto);
  }
}

@Controller('subjects')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class SubjectTeacherController {
  constructor(private readonly teachers: TeachersService) {}

  @Put(':id/teacher')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  assign(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTeacherDto,
  ) {
    return this.teachers.assignTeacher(membership, id, dto);
  }
}

@Controller('courses')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class CourseAssignmentsController {
  constructor(private readonly teachers: TeachersService) {}

  @Get(':id/assignments')
  assignments(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.teachers.courseAssignments(membership, id);
  }
}
