import { Module } from '@nestjs/common';
import {
  AttendanceController,
  StudentAttendanceController,
} from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  controllers: [AttendanceController, StudentAttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
