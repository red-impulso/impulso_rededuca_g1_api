import { Module } from '@nestjs/common';
import {
  GradesController,
  GradingPeriodsController,
} from './grades.controller.js';
import { GradesService } from './grades.service.js';

@Module({
  controllers: [GradesController, GradingPeriodsController],
  providers: [GradesService],
})
export class GradesModule {}
