import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Excluye una ruta del AuthGuard global. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
