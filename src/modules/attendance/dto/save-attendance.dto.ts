export type AttendanceStatus = 'present' | 'absent' | 'late' | 'justified';

export interface SaveAttendanceEntry {
  studentId: string;
  status: AttendanceStatus;
}

export class SaveAttendanceDto {
  courseId: string;
  date: string;
  entries: SaveAttendanceEntry[];
}
