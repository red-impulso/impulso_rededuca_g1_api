import { Module } from '@nestjs/common';
import {
  GradesController,
  GradingPeriodsController,
  StudentsController,
} from './grades.controller.js';
import { GradesService } from './grades.service.js';

@Module({
  controllers: [GradesController, GradingPeriodsController, StudentsController],
  providers: [GradesService],
})
export class GradesModule {}
