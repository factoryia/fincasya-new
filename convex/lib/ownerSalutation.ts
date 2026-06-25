import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Convierte Sr/Sra (u variantes) al saludo usado en mensajes. */
export function propietarioTratoLabel(
  tratamiento?: string | null,
): "señor" | "señora" {
  const t = String(tratamiento ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (
    t === "sra" ||
    t === "senora" ||
    t.startsWith("sra ") ||
    t.includes("senora")
  ) {
    return "señora";
  }
  return "señor";
}

export function ownerSalutationName(
  tratamiento: string | undefined | null,
  fullName: string | undefined | null,
): string {
  const first =
    String(fullName ?? "")
      .trim()
      .split(/\s+/)[0] || "propietario";
  return `${propietarioTratoLabel(tratamiento)} ${first}`;
}

type OwnerContact = {
  propietarioNombre?: string;
  propietarioTelefono?: string;
  propietarioTratamiento?: string;
};

/** Datos del propietario: prioriza propertyOwnerInfo (formulario admin). */
export async function resolveOwnerContactFields(
  ctx: Pick<QueryCtx, "db">,
  propertyId: Id<"properties">,
  property: Record<string, unknown> | null,
): Promise<OwnerContact> {
  const ownerInfo = await ctx.db
    .query("propertyOwnerInfo")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .unique();

  const fromProp = (key: string) =>
    String(property?.[key] ?? "").trim() || undefined;
  const fromInfo = (key: keyof OwnerContact) =>
    String(ownerInfo?.[key] ?? "").trim() || undefined;

  return {
    propietarioNombre:
      fromInfo("propietarioNombre") ?? fromProp("propietarioNombre"),
    propietarioTelefono:
      fromInfo("propietarioTelefono") ?? fromProp("propietarioTelefono"),
    propietarioTratamiento:
      fromInfo("propietarioTratamiento") ?? fromProp("propietarioTratamiento"),
  };
}
