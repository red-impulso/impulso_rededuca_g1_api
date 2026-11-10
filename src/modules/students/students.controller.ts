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
import { CreateStudentDto } from './dto/create-student.dto.js';
import { UpdateStudentDto } from './dto/update-student.dto.js';
import { StudentsService } from './students.service.js';

@Controller('students')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  list(
    @CurrentMembership() membership: Membership,
    @Query('courseId') courseId?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit = 25,
  ) {
    return this.students.list(membership, {
      courseId,
      q,
      status,
      page,
      limit,
    });
  }

  @Get(':id/profile')
  profile(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.students.profile(membership, id);
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateStudentDto,
  ) {
    return this.students.create(membership, dto);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.students.update(membership, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.students.remove(membership, id);
  }
}
