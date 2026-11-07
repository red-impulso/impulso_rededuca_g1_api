import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../auth/auth.guard.js';
import {
  MembershipGuard,
  type Membership,
} from '../../auth/membership.guard.js';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator.js';
import { ROLES_KEY } from '../../auth/roles.decorator.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import { CreateLeadDto } from './dto/create-lead.dto.js';
import { UpdateLeadDto } from './dto/update-lead.dto.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

const LEAD_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const INST = '11111111-2222-3333-4444-555555555555';

const pipe = new ValidationPipe({ whitelist: true });

const validBody = (over: Record<string, unknown> = {}) => ({
  institutionName: 'Colegio San Martín',
  contactName: 'María Pérez',
  city: 'Rosario',
  contactRole: 'Directora',
  level: 'Primario',
  contactChannel: 'maria@colegio.edu.ar',
  studentCount: 450,
  comment: 'Quieren una demo',
  privacyAccepted: true,
  ...over,
});

function validateCreate(body: unknown) {
  return pipe.transform(body, {
    type: 'body',
    metatype: CreateLeadDto,
  });
}

function validateUpdate(body: unknown) {
  return pipe.transform(body, {
    type: 'body',
    metatype: UpdateLeadDto,
  });
}

/** MembershipGuard real con una membresía del rol dado sobre `handler`. */
function membershipGuardContext(
  handler: object,
  opts: { role?: string; user?: object } = {},
) {
  const request: any = {
    headers: { 'x-institution-id': INST },
    user: opts.user ?? { id: 'u1', email: 'a@b.c' },
  };
  const context = {
    getHandler: () => handler,
    getClass: () => LeadsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const rows = opts.role
    ? [
        {
          id: 'm1',
          user_id: 'u1',
          institution_id: INST,
          role: opts.role,
        },
      ]
    : [];
  const q: any = {
    select: () => q,
    eq: () => q,
    then: (res: any, rej: any) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  const guard = new MembershipGuard(
    { admin: { from: () => q } } as any,
    new Reflector(),
  );
  return { guard, context, request };
}

function authGuardContext(handler: object, headers: Record<string, string>) {
  const request: any = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => LeadsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

describe('LeadsController', () => {
  let controller: LeadsController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      create: vi.fn(),
      list: vi.fn(),
      updateStatus: vi.fn(),
    };
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60000, limit: 5 }],
        }),
      ],
      controllers: [LeadsController],
      providers: [
        { provide: LeadsService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    controller = module.get(LeadsController);
  });

  describe('POST /leads · BONUS-1', () => {
    it('lead válido → 201 y persiste vía service', async () => {
      const dto = (await validateCreate(validBody())) as CreateLeadDto;
      service.create.mockResolvedValue({ id: LEAD_ID });

      await expect(controller.create(dto)).resolves.toEqual({ id: LEAD_ID });
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('website con texto → 201 { id: "honeypot" } sin persistir', async () => {
      const dto = (await validateCreate(
        validBody({ website: 'http://spam.example' }),
      )) as CreateLeadDto;

      expect(controller.create(dto)).toEqual({ id: 'honeypot' });
      expect(service.create).not.toHaveBeenCalled();
    });

    it('rate limit: @Throttle(5 req / 60 s) aplicado solo a create', () => {
      const reflector = new Reflector();
      expect(reflector.get('THROTTLER:LIMITdefault', controller.create)).toBe(
        5,
      );
      expect(reflector.get('THROTTLER:TTLdefault', controller.create)).toBe(
        60000,
      );
      expect(Reflect.getMetadata('__guards__', controller.create)).toContain(
        ThrottlerGuard,
      );
      // los endpoints admin no tienen throttle propio
      expect(
        reflector.get('THROTTLER:LIMITdefault', controller.list),
      ).toBeUndefined();
    });

    it('es público: @Public evita el AuthGuard global', async () => {
      const reflector = new Reflector();
      expect(reflector.get(IS_PUBLIC_KEY, controller.create)).toBe(true);
      const { guard, context, getUser } = authGuardContext(
        controller.create,
        {},
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(getUser).not.toHaveBeenCalled();
    });

    it.each([
      ['sin institutionName', { institutionName: undefined }],
      ['sin contactName', { contactName: undefined }],
      ['sin city', { city: undefined }],
      ['sin contactRole', { contactRole: undefined }],
      ['level inválido', { level: 'Universitario' }],
      ['studentCount 0', { studentCount: 0 }],
      ['studentCount > 100000', { studentCount: 100001 }],
      ['studentCount decimal', { studentCount: 4.5 }],
      ['studentCount string', { studentCount: '450' }],
      ['contactChannel inválido', { contactChannel: 'no-es-contacto' }],
      ['contactChannel email sin dominio', { contactChannel: 'a@b' }],
      ['contactChannel teléfono corto', { contactChannel: '1234' }],
      ['comment demasiado largo', { comment: 'x'.repeat(601) }],
      ['institutionName demasiado largo', { institutionName: 'x'.repeat(121) }],
      ['privacyAccepted false', { privacyAccepted: false }],
      ['privacyAccepted ausente', { privacyAccepted: undefined }],
      ['privacyAccepted string "true"', { privacyAccepted: 'true' }],
    ])('body inválido: %s → 400', async (_name, over) => {
      await expect(validateCreate(validBody(over))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('contactChannel acepta email o teléfono de 8-15 dígitos', async () => {
      await expect(
        validateCreate(validBody({ contactChannel: 'a@b.co' })),
      ).resolves.toBeTruthy();
      await expect(
        validateCreate(validBody({ contactChannel: '+5491155556666' })),
      ).resolves.toBeTruthy();
      await expect(
        validateCreate(validBody({ contactChannel: '1155556666' })),
      ).resolves.toBeTruthy();
    });
  });

  describe('GET /leads · BONUS-2', () => {
    it('admin → 200 con la lista del service', async () => {
      const items = [{ id: LEAD_ID, status: 'new' }];
      service.list.mockResolvedValue(items);

      const { guard, context } = membershipGuardContext(controller.list, {
        role: 'admin',
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);

      await expect(controller.list('new')).resolves.toEqual(items);
      expect(service.list).toHaveBeenCalledWith('new');
    });

    it('sin token → 401', async () => {
      const { guard, context } = authGuardContext(controller.list, {});
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it.each(['teacher', 'guardian', 'director'])(
      'rol %s → 403',
      async (role) => {
        const { guard, context } = membershipGuardContext(controller.list, {
          role,
        });
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      },
    );

    it('exige AuthGuard + MembershipGuard y @Roles("admin")', () => {
      const reflector = new Reflector();
      const guards = Reflect.getMetadata('__guards__', controller.list);
      expect(guards).toContain(AuthGuard);
      expect(guards).toContain(MembershipGuard);
      expect(reflector.get(ROLES_KEY, controller.list)).toEqual(['admin']);
    });
  });

  describe('PATCH /leads/:id · BONUS-2', () => {
    const membership: Membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'admin',
    };

    it('admin → 200 y devuelve el lead actualizado', async () => {
      const updated = { id: LEAD_ID, status: 'contacted' };
      service.updateStatus.mockResolvedValue(updated);

      const { guard, context } = membershipGuardContext(
        controller.updateStatus,
        { role: 'admin' },
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(context.switchToHttp().getRequest().membership).toEqual(
        membership,
      );

      const dto = (await validateUpdate({
        status: 'contacted',
      })) as UpdateLeadDto;
      await expect(controller.updateStatus(LEAD_ID, dto)).resolves.toEqual(
        updated,
      );
      expect(service.updateStatus).toHaveBeenCalledWith(LEAD_ID, dto);
    });

    it('id inexistente → 404', async () => {
      service.updateStatus.mockRejectedValue(
        new NotFoundException('Lead no encontrado'),
      );
      const dto = (await validateUpdate({
        status: 'discarded',
      })) as UpdateLeadDto;
      await expect(
        controller.updateStatus(LEAD_ID, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['status inválido', { status: 'pending' }],
      ['sin status', {}],
      ['status numérico', { status: 1 }],
    ])('body inválido: %s → 400', async (_name, body) => {
      await expect(validateUpdate(body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('sin token → 401', async () => {
      const { guard, context } = authGuardContext(controller.updateStatus, {});
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it.each(['teacher', 'guardian'])('rol %s → 403', async (role) => {
      const { guard, context } = membershipGuardContext(
        controller.updateStatus,
        { role },
      );
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
