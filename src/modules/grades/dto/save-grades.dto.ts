export interface SaveGradeEntry {
  studentId: string;
  value: number | null;
  observations?: string;
}

export class SaveGradesDto {
  subjectId: string;
  periodId: string;
  entries: SaveGradeEntry[];
}
