import {
  Body,
  Controller,
  Get,
  Patch,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentMembership } from '../../auth/current-membership.decorator.js';
import {
  MembershipGuard,
  type Membership,
} from '../../auth/membership.guard.js';
import { Roles } from '../../auth/roles.decorator.js';
import { UpdateInstitutionDto } from './dto/update-institution.dto.js';
import { InstitutionService } from './institution.service.js';

@Controller('institution')
@UseGuards(AuthGuard, MembershipGuard)
@Roles('admin', 'director')
export class InstitutionController {
  constructor(private readonly institution: InstitutionService) {}

  @Get()
  get(@CurrentMembership() membership: Membership) {
    return this.institution.get(membership);
  }

  @Patch()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  update(
    @CurrentMembership() membership: Membership,
    @Body() dto: UpdateInstitutionDto,
  ) {
    return this.institution.update(membership, dto);
  }

  @Put('logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  uploadLogo(
    @CurrentMembership() membership: Membership,
    @UploadedFile()
    file?: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer },
  ) {
    return this.institution.uploadLogo(membership, file);
  }
}
