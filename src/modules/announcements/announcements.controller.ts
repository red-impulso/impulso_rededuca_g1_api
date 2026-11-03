import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentMembership } from '../../auth/current-membership.decorator.js';
import {
  MembershipGuard,
  type Membership,
} from '../../auth/membership.guard.js';
import { Roles } from '../../auth/roles.decorator.js';
import type { CreateAnnouncementDto } from './dto/create-announcement.dto.js';
import { AnnouncementsService } from './announcements.service.js';

@Controller('announcements')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director', 'teacher', 'guardian')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Post()
  @Roles('admin', 'director', 'teacher')
  create(
    @CurrentMembership() membership: Membership,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcements.create(membership, dto);
  }

  @Get()
  list(@CurrentMembership() membership: Membership) {
    return this.announcements.list(membership);
  }
}
