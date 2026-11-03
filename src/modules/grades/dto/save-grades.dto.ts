export interface SaveGradeEntry {
  studentId: string;
  value: number | null;
}

export class SaveGradesDto {
  subjectId: string;
  periodId: string;
  entries: SaveGradeEntry[];
}
