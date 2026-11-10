import { IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export const COURSE_SHIFTS = ['morning', 'afternoon', 'evening'] as const;

export type CourseShift = (typeof COURSE_SHIFTS)[number];

export class CreateCourseDto {
  @IsInt()
  @Min(1)
  @Max(12)
  year: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  division: string;

  @IsIn(COURSE_SHIFTS)
  shift: CourseShift;

  @IsInt()
  @Min(1900)
  @Max(2100)
  schoolYear: number;
}
