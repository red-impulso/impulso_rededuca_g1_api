import { IsIn } from 'class-validator';

export const LEAD_STATUSES = ['new', 'contacted', 'discarded'] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export class UpdateLeadDto {
  @IsIn(LEAD_STATUSES)
  status: LeadStatus;
}
