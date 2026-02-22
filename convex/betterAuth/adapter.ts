import { createApi } from "@convex-dev/better-auth";
import { createAuthOptions, options } from "./auth";
import schema from "./schema";

// createApi llama a la función con contexto vacío para obtener el schema
// Usamos options estático cuando el contexto está vacío
export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, (ctx) => {
  // Si el contexto está vacío o no tiene las propiedades necesarias,
  // usar el objeto options estático
  if (!ctx || typeof ctx !== 'object' || !('db' in ctx)) {
    return options;
  }
  // Si tenemos un contexto válido, usar createAuthOptions normalmente
  return createAuthOptions(ctx);
});
