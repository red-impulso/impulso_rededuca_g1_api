import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NotificationsService,
  type AnnouncementCreatedEvent,
  type AttendanceSavedEvent,
  type GradesSavedEvent,
} from './notifications.service.js';

@Injectable()
export class NotificationsListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('grades.saved')
  onGradesSaved(payload: GradesSavedEvent) {
    return this.notifications.onGradesSaved(payload);
  }

  @OnEvent('attendance.saved')
  onAttendanceSaved(payload: AttendanceSavedEvent) {
    return this.notifications.onAttendanceSaved(payload);
  }

  @OnEvent('announcement.created')
  onAnnouncementCreated(payload: AnnouncementCreatedEvent) {
    return this.notifications.onAnnouncementCreated(payload);
  }
}
