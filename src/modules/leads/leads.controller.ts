import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthGuard } from '../../auth/auth.guard.js';
import { MembershipGuard } from '../../auth/membership.guard.js';
import { Public } from '../../auth/public.decorator.js';
import { Roles } from '../../auth/roles.decorator.js';
import { CreateLeadDto } from './dto/create-lead.dto.js';
import { UpdateLeadDto } from './dto/update-lead.dto.js';
import { LeadsService } from './leads.service.js';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /**
   * BONUS-1: captura pública de leads. El honeypot `website` finge éxito sin
   * persistir cuando un bot lo completa; ThrottlerGuard limita a 5 req/min
   * por IP.
   */
  @Public()
  @Post()
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ whitelist: true }))
  create(@Body() dto: CreateLeadDto) {
    if (dto.website?.trim()) {
      return { id: 'honeypot' };
    }
    return this.leads.create(dto);
  }

  /** BONUS-2: listado de leads, solo admin. */
  @Get()
  @UseGuards(AuthGuard, MembershipGuard)
  @Roles('admin')
  list(@Query('status') status?: string) {
    return this.leads.list(status);
  }

  /** BONUS-2: cambio de estado de un lead, solo admin. */
  @Patch(':id')
  @UseGuards(AuthGuard, MembershipGuard)
  @Roles('admin')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leads.updateStatus(id, dto);
  }
}
