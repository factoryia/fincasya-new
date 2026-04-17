import { createClient } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { admin } from 'better-auth/plugins';
import type { GenericCtx } from '@convex-dev/better-auth/utils';
import type { BetterAuthOptions } from 'better-auth';
import { betterAuth } from 'better-auth';
import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import authConfig from '../auth.config';
import schema from './schema';

// Better Auth Component
export const authComponent = createClient<DataModel, typeof schema>(
  components.betterAuth,
  {
    local: { schema },
    verbose: false,
  },
);

// Better Auth Options
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  // Detectar si el contexto es válido (tiene 'db')
  const hasValidCtx = ctx && typeof ctx === 'object' && 'db' in ctx;

  // Crear el adaptador - siempre intentar crearlo, incluso con contexto vacío
  // Esto es necesario para que createApi pueda obtener el schema
  const database = authComponent.adapter(ctx);

  // Forzar el puerto 3000 si Convex tiene cacheado 3001 en sus variables de entorno
  let siteUrl =
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000';
  if (siteUrl.includes('localhost:3001')) {
    siteUrl = 'http://localhost:3000';
  }

  return {
    appName: 'Fincas Ya',
    baseURL: siteUrl + '/api/auth',
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET,
    database,
    trustedOrigins: [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://adventurous-octopus-651.convex.site', // Agregamos el origen de convex mismo por seguridad
      'https://fincasya.com',
      'https://www.fincasya.com',
      'https://*.ngrok-free.dev',
    ],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user', // Predeterminado para clientes
          input: true,
        },
        documentId: {
          type: 'string',
          required: false,
          input: true,
        },
        phone: {
          type: 'string',
          required: false,
          input: true,
        },
        city: {
          type: 'string',
          required: false,
          input: true,
        },
        address: {
          type: 'string',
          required: false,
          input: true,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 días
      updateAge: 60 * 60 * 24, // refrescar cada 24h de uso
    },
    plugins: [
      convex({
        authConfig,
        options: {
          basePath: '/api/auth',
        },
        jwt: {
          expirationSeconds: 60 * 60 * 24, // 1 día (86400 s)
        },
      }),
      admin(),
    ],
  } satisfies BetterAuthOptions;
};

// For `@better-auth/cli` and createApi schema extraction
// Este objeto se usa cuando createApi necesita obtener el schema con contexto vacío
export const options = createAuthOptions({} as GenericCtx<DataModel>);

// Better Auth Instance
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth(createAuthOptions(ctx));
};
