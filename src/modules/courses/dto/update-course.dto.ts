import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COURSE_SHIFTS, type CourseShift } from './create-course.dto.js';

export class UpdateCourseDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  year?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  division?: string;

  @IsOptional()
  @IsIn(COURSE_SHIFTS)
  shift?: CourseShift;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  schoolYear?: number;
}
