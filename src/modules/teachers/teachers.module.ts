import { Module } from '@nestjs/common';
import {
  CourseAssignmentsController,
  SubjectTeacherController,
  TeachersController,
} from './teachers.controller.js';
import { TeachersService } from './teachers.service.js';

@Module({
  controllers: [
    TeachersController,
    SubjectTeacherController,
    CourseAssignmentsController,
  ],
  providers: [TeachersService],
})
export class TeachersModule {}
