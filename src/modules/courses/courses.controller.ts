import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CoursesService } from './courses.service.js';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';

@Controller('courses')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list(@CurrentMembership() membership: Membership) {
    return this.courses.list(membership);
  }

  @Get(':id')
  detail(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.courses.detail(membership, id);
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateCourseDto,
  ) {
    return this.courses.create(membership, dto);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.courses.update(membership, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.courses.remove(membership, id);
  }
}
