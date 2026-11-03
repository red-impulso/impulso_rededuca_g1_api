export type AnnouncementScope = 'institution' | 'course' | 'student';

export class CreateAnnouncementDto {
  scope: AnnouncementScope;
  courseId?: string;
  studentId?: string;
  title: string;
  body: string;
}
