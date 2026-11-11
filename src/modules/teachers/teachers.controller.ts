import {
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
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentMembership } from '../../auth/current-membership.decorator.js';
import {
  MembershipGuard,
  type Membership,
} from '../../auth/membership.guard.js';
import { Roles } from '../../auth/roles.decorator.js';
import { AssignTeacherDto } from './dto/assign-teacher.dto.js';
import { UpdateCourseAssignmentsDto } from './dto/course-assignments.dto.js';
import { CreateTeacherDto } from './dto/create-teacher.dto.js';
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
    @Query('shift') shift?: string,
    @Query('sort') sort?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit = 25,
  ) {
    return this.teachers.list(membership, {
      q,
      status,
      employmentStatus,
      courseId,
      subjectId,
      shift,
      sort,
      page,
      limit,
    });
  }

  @Get('counts')
  counts(@CurrentMembership() membership: Membership) {
    return this.teachers.counts(membership);
  }

  @Get('candidates')
  candidates(
    @CurrentMembership() membership: Membership,
    @Query('courseId') courseId?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.teachers.candidates(membership, { courseId, subjectId });
  }

  @Get('export')
  export(
    @CurrentMembership() membership: Membership,
    @Query('ids') ids?: string,
  ) {
    const list = ids
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.teachers.exportCsv(membership, list);
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateTeacherDto,
  ) {
    return this.teachers.create(membership, dto);
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  import(
    @CurrentMembership() membership: Membership,
    @UploadedFile()
    file?: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer },
  ) {
    return this.teachers.importCsv(membership, file);
  }

  @Get(':id')
  detail(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.teachers.detail(membership, id);
  }

  @Get(':id/activity')
  activity(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
  ) {
    return this.teachers.activity(membership, id, limit);
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

  @Put(':id/assignments')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  setAssignments(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseAssignmentsDto,
  ) {
    return this.teachers.setCourseAssignments(membership, id, dto);
  }
}
