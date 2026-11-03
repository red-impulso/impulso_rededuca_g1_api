import {
  Controller,
  Get,
  Param,
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
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director', 'teacher', 'guardian')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentMembership() membership: Membership) {
    return this.notifications.list(membership);
  }

  @Get('unread-count')
  unreadCount(@CurrentMembership() membership: Membership) {
    return this.notifications.unreadCount(membership);
  }

  @Post(':id/read')
  markRead(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(membership, id);
  }

  @Post('read-all')
  markAllRead(@CurrentMembership() membership: Membership) {
    return this.notifications.markAllRead(membership);
  }
}
