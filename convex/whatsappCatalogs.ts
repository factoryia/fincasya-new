import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { catalogPeopleCountForFilter } from "./lib/propertyCatalogCapacity";

/** Reglas de precio activas (misma idea que en `fincas.ts` / `calculateStayPrice`). */
async function getActivePricingRulesForCatalog(
  ctx: QueryCtx,
  propertyId: Id<"properties">,
) {
  const pricingRules = await ctx.db
    .query("propertyPricing")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();

  const activeRules = [];
  for (const rule of pricingRules) {
    let globalData = null;
    if (rule.globalRuleId) {
      globalData = await ctx.db.get(rule.globalRuleId);
    }
    const isActive = globalData?.activa !== false && (rule.activa ?? true);
    if (isActive) {
      activeRules.push({
        ...rule,
        fechaDesde: globalData?.fechaDesde || rule.fechaDesde,
        fechaHasta: globalData?.fechaHasta || rule.fechaHasta,
        fechas: globalData?.fechas || rule.fechas,
      });
    }
  }
  return activeRules.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

function getPriceForDateCatalog(
  dateStr: string,
  basePrice: number,
  activeRules: any[],
) {
  const parts = dateStr.split("-");
  if (parts.length < 3)
    return { price: basePrice, ruleName: "Estándar", ruleId: null };
  const mmdd = `${parts[1]}-${parts[2]}`;

  for (const rule of activeRules) {
    if (rule.fechas?.includes(mmdd)) {
      return {
        price: rule.valorUnico ?? basePrice,
        ruleName: rule.nombre || "Especial",
        ruleId: rule._id,
      };
    }
    if (rule.fechaDesde && rule.fechaHasta) {
      if (rule.fechaDesde <= rule.fechaHasta) {
        if (mmdd >= rule.fechaDesde && mmdd <= rule.fechaHasta) {
          return {
            price: rule.valorUnico ?? basePrice,
            ruleName: rule.nombre || "Especial",
            ruleId: rule._id,
          };
        }
      } else {
        if (mmdd >= rule.fechaDesde || mmdd <= rule.fechaHasta) {
          return {
            price: rule.valorUnico ?? basePrice,
            ruleName: rule.nombre || "Especial",
            ruleId: rule._id,
          };
        }
      }
    }
  }
  return { price: basePrice, ruleName: "Estándar", ruleId: null };
}

async function lodgingStaySummaryForCatalog(
  ctx: QueryCtx,
  propertyId: Id<"properties">,
  fechaEntrada: string,
  fechaSalida: string,
): Promise<{
  nightsCount: number;
  nightly: number;
  subtotal: number;
  appliedRule: string;
} | null> {
  const property = await ctx.db.get(propertyId);
  if (!property) return null;

  const activeRules = await getActivePricingRulesForCatalog(ctx, propertyId);
  const start = new Date(fechaEntrada + "T12:00:00");
  const end = new Date(fechaSalida + "T12:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    return null;
  }

  let dominantRule: { price: number; ruleName: string } | null = null;
  const tempCurrent = new Date(start);
  while (tempCurrent < end) {
    const dateStr = tempCurrent.toISOString().split("T")[0];
    const { price, ruleName } = getPriceForDateCatalog(
      dateStr,
      property.priceBase,
      activeRules,
    );
    if (ruleName !== "Estándar") {
      if (!dominantRule) dominantRule = { price, ruleName };
    }
    tempCurrent.setDate(tempCurrent.getDate() + 1);
  }

  const finalNightlyPrice = dominantRule
    ? dominantRule.price
    : property.priceBase;
  const finalRuleName = dominantRule ? dominantRule.ruleName : "Estándar";

  let current = new Date(start);
  let subtotal = 0;
  let nightsCount = 0;
  while (current < end) {
    subtotal += finalNightlyPrice;
    nightsCount += 1;
    current.setDate(current.getDate() + 1);
  }

  return {
    nightsCount,
    nightly: finalNightlyPrice,
    subtotal,
    appliedRule: finalRuleName,
  };
}

/** Formato tipo WhatsApp: `$ 3.850.000` (punto miles, espacio tras `$`). */
function formatMoneyCopQuote(n: number): string {
  const int = Math.round(Number(n));
  if (!Number.isFinite(int)) return "$ 0";
  const withDots = Math.abs(int)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return int < 0 ? `- $ ${withDots}` : `$ ${withDots}`;
}

/** Una línea por tarjeta de catálogo (precio según reglas internas; sin nombre de temporada al cliente). */
function quoteLineForStay(
  nightsCount: number,
  nightly: number,
  subtotal: number,
  _appliedRule: string,
): string {
  const nocheWord = nightsCount === 1 ? "noche" : "noches";
  return `💰 Para tus fechas (${nightsCount} ${nocheWord}): ${formatMoneyCopQuote(nightly)}/noche. Total alojamiento: ${formatMoneyCopQuote(subtotal)}.`;
}

/**
 * Catálogos de WhatsApp configurados en la base de datos (sin env vars).
 * Un catálogo tiene nombre, ID de Meta y opcionalmente palabra clave de ubicación o isDefault.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("whatsappCatalogs").collect();
    return all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  },
});

export const getById = query({
  args: { id: v.id("whatsappCatalogs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Catálogo por defecto (isDefault: true); si no hay, el primero por order. */
export const getDefault = query({
  args: {},
  handler: async (ctx) => {
    const byDefault = await ctx.db
      .query("whatsappCatalogs")
      .withIndex("by_is_default", (q) => q.eq("isDefault", true))
      .first();
    if (byDefault) return byDefault;
    const all = await ctx.db.query("whatsappCatalogs").collect();
    return all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))[0] ?? null;
  },
});

/** Catálogo cuya locationKeyword está contenida en la ubicación (ej. "tolima" en "Villavicencio Tolima"). */
export const getByLocationKeyword = query({
  args: { location: v.string() },
  handler: async (ctx, args) => {
    const locLower = args.location.trim().toLowerCase();
    if (!locLower) return null;
    const catalogs = await ctx.db.query("whatsappCatalogs").collect();
    return (
      catalogs.find(
        (c) => c.locationKeyword && locLower.includes(c.locationKeyword.toLowerCase())
      ) ?? null
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    whatsappCatalogId: v.string(),
    isDefault: v.optional(v.boolean()),
    locationKeyword: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("whatsappCatalogs", {
      name: args.name,
      whatsappCatalogId: args.whatsappCatalogId,
      isDefault: args.isDefault ?? false,
      locationKeyword: args.locationKeyword,
      order: args.order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("whatsappCatalogs"),
    name: v.optional(v.string()),
    whatsappCatalogId: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    locationKeyword: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Catálogo no encontrado");
    await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("whatsappCatalogs") },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_catalog", (q) => q.eq("catalogId", args.id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    await ctx.db.delete(args.id);
    return args.id;
  },
});

/**
 * Sincroniza catálogos desde Meta a la tabla whatsappCatalogs.
 * Crea los que no existen; actualiza nombre de los que ya existen por whatsappCatalogId.
 */
export const syncFromMeta = internalMutation({
  args: {
    catalogs: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query("whatsappCatalogs").collect();
    const byMetaId = new Map(existing.map((c) => [c.whatsappCatalogId, c]));

    for (let i = 0; i < args.catalogs.length; i++) {
      const cat = args.catalogs[i];
      const row = byMetaId.get(cat.id);
      if (row) {
        if (row.name !== cat.name) {
          await ctx.db.patch(row._id, { name: cat.name, updatedAt: now });
        }
      } else {
        await ctx.db.insert("whatsappCatalogs", {
          name: cat.name,
          whatsappCatalogId: cat.id,
          isDefault: i === 0,
          order: i,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return args.catalogs.length;
  },
});

/**
 * Seed: crea el catálogo "Catálogo_productos" (Meta 1560075992300705) y asocia la finca
 * VILLA GREEN 12 pax #vc115 (product_retailer_id quk9ne5y4o). Idempotente.
 * Ejecutar una vez: npx convex run whatsappCatalogs:seedCatalogProductos
 */
export const seedCatalogProductos = mutation({
  args: {},
  handler: async (ctx) => {
    const META_CATALOG_ID = "1560075992300705";
    const PROPERTY_ID = "js797fftx557dg5gb9yd9et8s581g9dy" as Id<"properties">;
    const PRODUCT_RETAILER_ID = "quk9ne5y4o";
    const now = Date.now();

    let catalog = (await ctx.db.query("whatsappCatalogs").collect()).find(
      (c) => c.whatsappCatalogId === META_CATALOG_ID
    );
    if (!catalog) {
      const id = await ctx.db.insert("whatsappCatalogs", {
        name: "Catálogo_productos",
        whatsappCatalogId: META_CATALOG_ID,
        isDefault: true,
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
      catalog = (await ctx.db.get(id))!;
    }

    const existing = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_property_and_catalog", (q) =>
        q.eq("propertyId", PROPERTY_ID).eq("catalogId", catalog._id)
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("propertyWhatsAppCatalog", {
        propertyId: PROPERTY_ID,
        catalogId: catalog._id,
        productRetailerId: PRODUCT_RETAILER_ID,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      catalogId: catalog._id,
      catalogName: catalog.name,
      propertyId: PROPERTY_ID,
      productRetailerId: PRODUCT_RETAILER_ID,
    };
  },
});

/**
 * Payload para n8n/YCloud: Meta catalog_id + product_retailer_id por ubicación.
 * Elige catálogo por locationKeyword (misma lógica que getByLocationKeyword) o el primero por order.
 */
function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

/**
 * Cotización para el bot (FSM) cuando ya hay finca elegida por `product_retailer_id` y fechas.
 * Misma lógica de precios que las tarjetas del catálogo (sin nombre de temporada al cliente).
 */
export const getBotStayQuoteByRetailerId = query({
  args: {
    productRetailerId: v.string(),
    fechaEntrada: v.string(),
    fechaSalida: v.string(),
    cupo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rid = String(args.productRetailerId ?? "").trim();
    const feIn = String(args.fechaEntrada ?? "").trim();
    const feOut = String(args.fechaSalida ?? "").trim();
    if (!rid || !isYmd(feIn) || !isYmd(feOut)) return null;
    if (
      new Date(feIn + "T12:00:00").getTime() >= new Date(feOut + "T12:00:00").getTime()
    ) {
      return null;
    }

    const links = await ctx.db.query("propertyWhatsAppCatalog").collect();
    const link = links.find((l) => String(l.productRetailerId ?? "").trim() === rid);
    if (!link) return null;
    const property = await ctx.db.get(link.propertyId);
    if (!property) return null;

    const stay = await lodgingStaySummaryForCatalog(ctx, link.propertyId, feIn, feOut);
    if (!stay || stay.nightsCount <= 0 || stay.nightly <= 0) return null;

    const title = (property.title ?? "").trim() || "Tu finca seleccionada";
    const quoteLine = quoteLineForStay(
      stay.nightsCount,
      stay.nightly,
      stay.subtotal,
      stay.appliedRule,
    );
    const lines = [`📋 *Resumen de tu estadía*`, `🏡 *${title}*`, quoteLine];
    if (args.cupo != null && args.cupo > 0) {
      lines.push(`👥 *${args.cupo} personas*`);
    }
    // Devolvemos también los números crudos para que el bot pueda calcular
    // totales adicionales (mascotas, etc.) y mostrar un GRAN total al cliente.
    const damageDeposit = Math.max(
      0,
      Number(property.depositoDanosReembolsable ?? 0) || 0,
    );
    const wristbandFee = Math.max(
      0,
      Number(property.manillaCondominio ?? 0) || 0,
    );

    return {
      text: lines.join("\n"),
      totals: {
        propertyTitle: title,
        nightly: stay.nightly,
        nightsCount: stay.nightsCount,
        subtotal: stay.subtotal,
        appliedRule: stay.appliedRule,
        cupo: args.cupo,
        damageDeposit,
        wristbandFee,
      },
    };
  },
});

export const getPayloadByLocationForN8n = query({
  args: {
    location: v.string(),
    limit: v.optional(v.number()),
    /** Check-in / check-out (YYYY-MM-DD). Si ambos válidos, se devuelve `productQuoteLines` alineado con cada producto. */
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    /** Capacidad mínima requerida (número de personas). Filtra fincas con capacity >= minCapacity. */
    minCapacity: v.optional(v.number()),
    /** Capacidad máxima permitida (número de personas). Filtra fincas con capacity <= maxCapacity. */
    maxCapacity: v.optional(v.number()),
    /** Capacidad máxima permitida en la pasada **intermedia** (cuando no hay
     *  suficientes en el rango estricto). Mayor que `maxCapacity` pero acotada.
     *  Si no se pasa, la pasada intermedia se omite y se cae al fallback sin tope. */
    maxCapacityRelaxed: v.optional(v.number()),
    /** true = solo fincas para eventos; false = excluye fincas de eventos (descanso/familiar); undefined = sin filtro. */
    isEvento: v.optional(v.boolean()),
    /**
     * Lista de `productRetailerId` a EXCLUIR del resultado. Se usa para
     * paginación: cuando el cliente pide "ver más", el inbound pasa los
     * retailerIds ya enviados (via `getAllCatalogRetailerIdsForConversation`)
     * y el query devuelve solo fincas nuevas.
     */
    excludeRetailerIds: v.optional(v.array(v.string())),
    /**
     * Lista de keywords de ubicación a EXCLUIR (cualquier match parcial en
     * `property.location` descarta la finca). Útil cuando el cliente dice
     * "no en los llanos" → se pasa `["villavicencio", "restrepo", "acacias",
     * "cumaral"]` y esas fincas no aparecen.
     */
    excludeLocationKeywords: v.optional(v.array(v.string())),
    /**
     * Lista de keywords de ubicación que RESTRINGEN el resultado: solo se
     * incluyen fincas cuya `property.location` contenga alguna keyword. Útil
     * cuando el cliente dice "cerca a Bogotá" → restringimos a municipios de
     * Cundinamarca; "en Tolima" → solo Tolima; etc.
     *
     * Si está vacío o undefined, NO restringe (acepta cualquier ubicación,
     * sujeto a las demás reglas — `matchesLocation` y excluyentes).
     */
    restrictToLocationKeywords: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const cap = Math.min(Math.max(args.limit ?? 30, 1), 30);
    const locLower = args.location.trim().toLowerCase();
    // Sentinel especial: "RECOMENDADAS" → fincas favoritas (isFavorite=true) sin filtro de municipio.
    const isRecomendadas = locLower === "recomendadas";
    if (!locLower) {
      return {
        catalogId: "",
        productRetailerIds: [] as string[],
        productQuoteLines: [] as string[],
        productTitles: [] as string[],
        bodyText: "",
      };
    }

    const catalogs = await ctx.db.query("whatsappCatalogs").collect();
    const byKw = isRecomendadas
      ? null
      : (catalogs.find(
          (c) =>
            c.locationKeyword &&
            locLower.includes(c.locationKeyword.toLowerCase()),
        ) ?? null);
    const byDefault = await ctx.db
      .query("whatsappCatalogs")
      .withIndex("by_is_default", (q) => q.eq("isDefault", true))
      .first();
    const catalog =
      byKw ??
      byDefault ??
      catalogs.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))[0] ??
      null;

    if (!catalog) {
      return {
        catalogId: "",
        productRetailerIds: [] as string[],
        productQuoteLines: [] as string[],
        productTitles: [] as string[],
        bodyText: "",
      };
    }

    const links = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_catalog", (q) => q.eq("catalogId", catalog._id))
      .collect();

    const feIn = String(args.fechaEntrada ?? "").trim();
    const feOut = String(args.fechaSalida ?? "").trim();
    const datesOk =
      isYmd(feIn) &&
      isYmd(feOut) &&
      new Date(feIn + "T12:00:00").getTime() <
        new Date(feOut + "T12:00:00").getTime();

    const productRetailerIds: string[] = [];
    const productQuoteLines: string[] = [];
    const productTitles: string[] = [];

    // Recolección por pasadas con prioridad para tolerar BD escasa de favoritas.
    // Si hay cupo (`minCapacity` > 0), NUNCA se omiten pasadas que respetan ese mínimo:
    // no se rellena el catálogo con fincas más pequeñas que lo pedido (evita p. ej. 10 y 13 cuando pidieron 22).
    // Sin cupo en args, se conserva el fallback amplio (favoritas sin capacidad / solo ubicación).
    type Pass = {
      label: string;
      keep: (p: any) => boolean;
    };

    const matchesLocation = (p: any) =>
      isRecomendadas ? true : p.location.toLowerCase().includes(locLower);
    /**
     * Filtro de capacidad:
     *   - `min` se compara contra `effectivePeopleCount` (capacity para descanso,
     *     o max(capacity, eventCapacity) si es evento Y la finca permite eventos).
     *     Una finca con `eventCapacity=80` puede albergar a un cliente que pidió 20
     *     en evento aunque solo duerma 22 personas.
     *   - `max` se compara contra `sleepCapacity` (siempre `capacity`, hospedaje).
     *     El techo `maxCapacity` está pensado para no ofrecer fincas con
     *     DEMASIADAS CAMAS al cliente (ej. finca de 30 a quien pidió 4 personas).
     *
     * IMPORTANTE: para EVENTOS (`args.isEvento === true`) el techo se OMITE
     * por completo. Un cliente con 10 personas que va a hacer un cumpleaños
     * puede usar perfectamente una finca de 25 PAX con `eventCapacity` 50 (le
     * sobra espacio para la fiesta + cabe sin problema todo el grupo). Si
     * aplicáramos el techo de hospedaje (~cupo + buffer) muchas fincas
     * grandes de eventos quedarían descartadas — devolviendo "catálogo vacío"
     * cuando claramente hay opciones servibles. El asesor / cliente decide
     * si una finca es "demasiado grande" para su evento, no el filtro.
     */
    const matchesCapacity = (p: any) => {
      const eventEff = catalogPeopleCountForFilter(p, args.isEvento);
      const sleepCap = Math.max(0, Number(p.capacity ?? 0));
      if (args.minCapacity != null && eventEff < args.minCapacity) return false;
      if (
        args.isEvento !== true &&
        args.maxCapacity != null &&
        sleepCap > args.maxCapacity
      ) {
        return false;
      }
      return true;
    };
    /**
     * Pasada intermedia: respeta el mínimo (usando eventCapacity si aplica) y
     * aplica un **techo relajado** sobre el cupo de hospedaje. Mismo principio
     * que `matchesCapacity`: el `max` solo limita CAMAS (`capacity`), no la
     * capacidad de evento — y para EVENTOS, igual que arriba, el techo se
     * omite por completo (cualquier finca lo suficientemente grande sirve).
     */
    const matchesCapacityRelaxed = (p: any) => {
      const eventEff = catalogPeopleCountForFilter(p, args.isEvento);
      const sleepCap = Math.max(0, Number(p.capacity ?? 0));
      if (args.minCapacity != null && eventEff < args.minCapacity) return false;
      if (
        args.isEvento !== true &&
        args.maxCapacityRelaxed != null &&
        sleepCap > args.maxCapacityRelaxed
      ) {
        return false;
      }
      return true;
    };
    /**
     * Filtro de eventos: **DESACTIVADO por política comercial**.
     *
     * Antes excluía fincas con `familyOnly === true` y `allowsEventsContent
     * === false` cuando el cliente confirmaba `isEvento=true`. Eso producía
     * "catálogo vacío" en zonas donde la mayoría de fincas están marcadas
     * "solo familiar" — aunque para un cumpleaños familiar básico aplican
     * perfecto y la cliente quiere verlas.
     *
     * Política nueva: enviar TODAS las fincas que cuadran con capacidad +
     * ubicación, independiente de los flags de evento. El asesor confirma
     * caso por caso si la finca es adecuada cuando la logística del evento
     * es pesada (DJ, banda); para eventos "básicos" (cumpleaños familiar
     * con sonido de la finca) el cliente reserva normal. Ver guard 3.57 en
     * `index.ts` y bloque post-catálogo evento en `inbound.ts`.
     */
    const matchesEvento = (_p: any) => true;

    const enforceClientCupo =
      args.minCapacity != null &&
      Number.isFinite(args.minCapacity) &&
      args.minCapacity > 0;

    const passes: Pass[] = isRecomendadas
      ? [
          {
            label: "fav+cap+ev",
            keep: (p) =>
              p.isFavorite === true &&
              matchesCapacity(p) &&
              matchesEvento(p),
          },
          {
            label: "fav+capRelaxed+ev",
            keep: (p) =>
              p.isFavorite === true &&
              matchesCapacityRelaxed(p) &&
              matchesEvento(p),
          },
          ...(enforceClientCupo
            ? []
            : [
                {
                  label: "fav+ev",
                  keep: (p: any) =>
                    p.isFavorite === true && matchesEvento(p),
                } satisfies Pass,
              ]),
          {
            label: "cap+ev",
            keep: (p) => matchesCapacity(p) && matchesEvento(p),
          },
          {
            label: "capRelaxed+ev",
            keep: (p) => matchesCapacityRelaxed(p) && matchesEvento(p),
          },
          ...(enforceClientCupo
            ? []
            : [{ label: "any", keep: () => true } satisfies Pass]),
        ]
      : [
          {
            label: "loc+cap+ev",
            keep: (p) =>
              matchesLocation(p) && matchesCapacity(p) && matchesEvento(p),
          },
          // Respeta el cupo mínimo y aplica un techo relajado (`maxCapacityRelaxed`,
          // ~1.7x el cupo). NO permite fincas absurdamente grandes (ej. una de 53
          // para alguien que pidió 22).
          {
            label: "loc+capRelaxed+ev",
            keep: (p) =>
              matchesLocation(p) && matchesCapacityRelaxed(p) && matchesEvento(p),
          },
          // Pasada final cuando enforceClientCupo: respeta el cupo mínimo
          // pero IGNORA el techo de hospedaje. Captura fincas grandes (ej. 25
          // PAX para alguien con cupo 13). El cliente decide si son
          // demasiado grandes o si le sirven. Esta pasada se agrega para
          // garantizar que el catálogo no quede escaso (objetivo: enviar
          // mínimo 8 fincas si hay disponibles en la zona).
          ...(enforceClientCupo
            ? [
                {
                  label: "loc+minOnly+ev",
                  keep: (p: any) => {
                    const eventEff = catalogPeopleCountForFilter(
                      p,
                      args.isEvento,
                    );
                    if (
                      args.minCapacity != null &&
                      eventEff < args.minCapacity
                    ) {
                      return false;
                    }
                    return matchesLocation(p) && matchesEvento(p);
                  },
                } satisfies Pass,
              ]
            : [
                {
                  label: "loc+ev",
                  keep: (p: any) =>
                    matchesLocation(p) && matchesEvento(p),
                } satisfies Pass,
                {
                  label: "loc",
                  keep: (p: any) => matchesLocation(p),
                } satisfies Pass,
              ]),
        ];

    const seen = new Set<string>();
    type LinkProp = {
      link: (typeof links)[number];
      property: any;
      retailerId: string;
    };
    // Set de retailerIds a excluir (paginación: cliente pidió "ver más", ya
    // vio estas fincas en envíos anteriores).
    const excludeSet = new Set(
      (args.excludeRetailerIds ?? []).map((s) => String(s ?? "").trim()).filter(Boolean),
    );

    // Helper para normalizar texto (lowercase + sin tildes) y comparar.
    const normalizeLoc = (s: string): string =>
      String(s ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");

    // Keywords de ubicación a excluir (cliente dijo "no llanos", etc.).
    const excludeLocationKeywordsLower = (args.excludeLocationKeywords ?? [])
      .map((k) => normalizeLoc(String(k ?? "").trim()))
      .filter(Boolean);
    const matchesExcludedLocation = (p: any): boolean => {
      if (excludeLocationKeywordsLower.length === 0) return false;
      const propLocLower = normalizeLoc(String(p.location ?? ""));
      if (!propLocLower) return false;
      return excludeLocationKeywordsLower.some((kw) => propLocLower.includes(kw));
    };

    // Keywords de ubicación que RESTRINGEN: solo aceptamos fincas que
    // matcheen alguna. Útil para "cerca a Bogotá" → restrict Cundinamarca.
    const restrictToLocationKeywordsLower = (args.restrictToLocationKeywords ?? [])
      .map((k) => normalizeLoc(String(k ?? "").trim()))
      .filter(Boolean);
    const matchesRestrictedLocation = (p: any): boolean => {
      if (restrictToLocationKeywordsLower.length === 0) return true; // no restriction
      const propLocLower = normalizeLoc(String(p.location ?? ""));
      if (!propLocLower) return false;
      return restrictToLocationKeywordsLower.some((kw) => propLocLower.includes(kw));
    };

    // Materializa links con propiedad ya cargada (evita re-leer entre pasadas).
    const candidates: LinkProp[] = [];
    for (const link of links) {
      const p = await ctx.db.get(link.propertyId);
      if (!p || p.active === false || p.visible === false) continue;
      const id = String(link.productRetailerId || "").trim();
      if (!id) continue;
      if (excludeSet.has(id)) continue;
      if (matchesExcludedLocation(p)) continue;
      if (!matchesRestrictedLocation(p)) continue;
      candidates.push({ link, property: p, retailerId: id });
    }

    // Ordenar candidatos por TIERS:
    //   1. Favoritas primero (`isFavorite === true`) — política comercial:
    //      las fincas marcadas como favoritas son las que el equipo quiere
    //      destacar primero al cliente.
    //   2. Dentro de cada tier, por PROXIMIDAD al cupo solicitado (closest
    //      match) — un cliente pidiendo 13 personas ve 13 → 14 → 15 → 16 →
    //      ... → 25 PAX en ese orden, no mezclado.
    //   3. Empate por distancia: precio asc (cliente ve opciones más baratas
    //      primero), luego orden alfabético del título para consistencia.
    //
    // Métrica de proximidad: `effectivePeopleCount` (para eventos =
    // max(capacity, eventCapacity); para descanso = capacity). Distancia
    // = |effective - cupo|.
    //
    // Si no se pasó `minCapacity` (cliente sin cupo definido), el orden es
    // solo favoritas → no-favoritas (sin sort por distancia porque no
    // tenemos referencia).
    candidates.sort((a, b) => {
      // Tier 1: favoritas primero
      const aFav = a.property.isFavorite === true ? 0 : 1;
      const bFav = b.property.isFavorite === true ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;

      // Tier 2: proximidad al cupo (solo si hay cupo)
      if (args.minCapacity != null && args.minCapacity > 0) {
        const targetCupo = args.minCapacity;
        const aEff = catalogPeopleCountForFilter(a.property, args.isEvento);
        const bEff = catalogPeopleCountForFilter(b.property, args.isEvento);
        const aDist = Math.abs(aEff - targetCupo);
        const bDist = Math.abs(bEff - targetCupo);
        if (aDist !== bDist) return aDist - bDist;
      }

      // Tier 3: precio asc (más barato primero)
      const aPrice = Number(a.property.priceBase ?? 0);
      const bPrice = Number(b.property.priceBase ?? 0);
      if (aPrice !== bPrice) return aPrice - bPrice;

      return 0;
    });

    for (const pass of passes) {
      if (productRetailerIds.length >= cap) break;
      for (const c of candidates) {
        if (productRetailerIds.length >= cap) break;
        if (seen.has(c.retailerId)) continue;
        if (!pass.keep(c.property)) continue;
        seen.add(c.retailerId);
        productRetailerIds.push(c.retailerId);
        productTitles.push(
          String(c.property.title ?? c.property.slug ?? c.retailerId).trim() || c.retailerId,
        );
        if (datesOk) {
          const stay = await lodgingStaySummaryForCatalog(
            ctx,
            c.link.propertyId,
            feIn,
            feOut,
          );
          productQuoteLines.push(
            stay &&
              stay.nightsCount > 0 &&
              stay.nightly > 0 &&
              stay.subtotal > 0
              ? quoteLineForStay(
                  stay.nightsCount,
                  stay.nightly,
                  stay.subtotal,
                  stay.appliedRule,
                )
              : "",
          );
        } else {
          productQuoteLines.push("");
        }
      }
    }

    const place = args.location.trim();
    return {
      catalogId: catalog.whatsappCatalogId,
      productRetailerIds,
      productQuoteLines,
      productTitles,
      bodyText: productRetailerIds.length
        ? isRecomendadas
          ? "Nuestras fincas favoritas 🏡✨"
          : `Opciones en ${place}`
        : isRecomendadas
          ? "No hay fincas favoritas en catálogo por ahora."
          : `No hay fincas en catálogo para ${place} por ahora.`,
    };
  },
});

/** Dado un product_retailer_id (de una tarjeta de catálogo WhatsApp), devuelve datos para UI (inbox / n8n). */
export const getPropertyByRetailerId = query({
  args: {
    productRetailerId: v.string(),
  },
  handler: async (ctx, args) => {
    const rid = args.productRetailerId.trim();
    const empty = {
      propertyName: "",
      location: "",
      productRetailerId: rid,
      propertyId: "",
      slug: "",
      imageUrl: "",
      priceBase: 0,
    };
    if (!rid) return { ...empty, productRetailerId: "" };
    const links = await ctx.db.query("propertyWhatsAppCatalog").collect();
    const link = links.find(
      (l) => String(l.productRetailerId || "").trim() === rid,
    );
    if (!link) return empty;
    const property = await ctx.db.get(link.propertyId);
    if (!property) {
      return {
        ...empty,
        propertyId: link.propertyId,
      };
    }
    const images = await ctx.db
      .query("propertyImages")
      .withIndex("by_property", (q) => q.eq("propertyId", link.propertyId))
      .collect();
    const sorted = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const imageUrl = sorted[0]?.url ?? "";
    return {
      propertyName: property.title ?? "",
      location: property.location ?? "",
      productRetailerId: rid,
      propertyId: property._id,
      slug: (property.slug ?? property.code ?? "").trim(),
      imageUrl,
      priceBase: typeof property.priceBase === "number" ? property.priceBase : 0,
    };
  },
});

/**
 * Diagnóstico: explica POR QUÉ una finca específica aparece o NO aparece en
 * el catálogo WhatsApp para una búsqueda dada. Util para debuggear casos como
 * "Villa Nativa no me sale en Villavicencio aunque la veo en la web".
 *
 * Devuelve cada paso de verificación con un veredicto (`pass` / `fail`) y la
 * razón. La usuaria/admin puede correr esto desde el panel o `bunx convex run`:
 *
 *   bunx convex run whatsappCatalogs:diagnoseCatalogFincaVisibility '{
 *     "productRetailerIdOrSlug": "VC#016",
 *     "location": "Villavicencio",
 *     "cupo": 13,
 *     "isEvento": false
 *   }'
 */
export const diagnoseCatalogFincaVisibility = query({
  args: {
    /** Puede ser productRetailerId (ej. "VC#016") o slug de la finca. */
    productRetailerIdOrSlug: v.string(),
    /** Municipio que el cliente solicitó (ej. "Villavicencio"). */
    location: v.string(),
    /** Cupo solicitado (personas). */
    cupo: v.number(),
    /** Si es evento. */
    isEvento: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const steps: Array<{
      step: string;
      verdict: "pass" | "fail" | "info";
      detail: string;
    }> = [];
    const id = args.productRetailerIdOrSlug.trim();
    if (!id) {
      return {
        steps: [
          {
            step: "input",
            verdict: "fail" as const,
            detail: "productRetailerIdOrSlug vacío",
          },
        ],
      };
    }

    // 1. Encontrar el catálogo WhatsApp para la ubicación pedida.
    const catalogs = await ctx.db.query("whatsappCatalogs").collect();
    const locLower = args.location.trim().toLowerCase();
    const byKw = catalogs.find(
      (c) =>
        c.locationKeyword &&
        locLower.includes(c.locationKeyword.toLowerCase()),
    );
    const byDefault = catalogs.find((c) => c.isDefault === true);
    const catalog = byKw ?? byDefault ?? catalogs[0] ?? null;
    if (!catalog) {
      steps.push({
        step: "catálogo-por-ubicación",
        verdict: "fail",
        detail: "No hay catálogos WhatsApp configurados en la BD.",
      });
      return { steps };
    }
    steps.push({
      step: "catálogo-por-ubicación",
      verdict: "pass",
      detail: `Usando catálogo "${catalog.name ?? catalog._id}" (locationKeyword="${catalog.locationKeyword ?? ""}", isDefault=${catalog.isDefault === true}).`,
    });

    // 2. Buscar la finca: por productRetailerId en links O por slug en properties.
    const allLinks = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_catalog", (q) => q.eq("catalogId", catalog._id))
      .collect();
    let link = allLinks.find(
      (l) => String(l.productRetailerId || "").trim() === id,
    );
    let property: any = null;
    if (link) {
      property = await ctx.db.get(link.propertyId);
      steps.push({
        step: "link-por-retailerId",
        verdict: "pass",
        detail: `Link encontrado: productRetailerId="${link.productRetailerId}", propertyId="${link.propertyId}".`,
      });
    } else {
      // Buscar property por slug/code y luego ver si tiene link a este catálogo.
      const props = await ctx.db.query("properties").collect();
      const propBySlug = props.find(
        (p) =>
          (p.slug ?? "").trim().toLowerCase() === id.toLowerCase() ||
          (p.code ?? "").trim().toLowerCase() === id.toLowerCase(),
      );
      if (propBySlug) {
        property = propBySlug;
        const allLinksGlobal = await ctx.db
          .query("propertyWhatsAppCatalog")
          .collect();
        const linksForThisProp = allLinksGlobal.filter(
          (l) => l.propertyId === propBySlug._id,
        );
        if (linksForThisProp.length === 0) {
          steps.push({
            step: "link-por-slug",
            verdict: "fail",
            detail: `La finca "${propBySlug.title ?? propBySlug.slug}" existe en \`properties\` (id=${propBySlug._id}) pero NO está vinculada a NINGÚN catálogo WhatsApp. Hay que crear el link en \`propertyWhatsAppCatalog\` desde el panel admin con el productRetailerId correcto.`,
          });
          return { steps, property: { id: propBySlug._id, title: propBySlug.title } };
        }
        const linkForThisCatalog = linksForThisProp.find(
          (l) => l.catalogId === catalog._id,
        );
        if (!linkForThisCatalog) {
          steps.push({
            step: "link-por-slug",
            verdict: "fail",
            detail: `La finca "${propBySlug.title}" está vinculada a OTRO catálogo (no al de "${catalog.locationKeyword ?? catalog.name}"). Vinculaciones existentes: ${linksForThisProp
              .map((l) => `catalogId=${l.catalogId} retailerId=${l.productRetailerId}`)
              .join(" | ")}.`,
          });
          return { steps, property: { id: propBySlug._id, title: propBySlug.title } };
        }
        link = linkForThisCatalog;
        steps.push({
          step: "link-por-slug",
          verdict: "pass",
          detail: `Link encontrado para este catálogo: retailerId="${link.productRetailerId}".`,
        });
      } else {
        steps.push({
          step: "buscar-finca",
          verdict: "fail",
          detail: `No se encontró ninguna finca con productRetailerId="${id}", slug="${id}", ni code="${id}". Verifica el código exacto.`,
        });
        return { steps };
      }
    }
    if (!property) {
      steps.push({
        step: "cargar-property",
        verdict: "fail",
        detail: `Link existe pero property con id ${link?.propertyId} no se pudo cargar.`,
      });
      return { steps };
    }

    // 3. Flags active/visible.
    if (property.active === false) {
      steps.push({
        step: "flag-active",
        verdict: "fail",
        detail: "property.active === false → excluida del catálogo.",
      });
    } else {
      steps.push({
        step: "flag-active",
        verdict: "pass",
        detail: `active=${property.active ?? "(unset, OK)"}`,
      });
    }
    if (property.visible === false) {
      steps.push({
        step: "flag-visible",
        verdict: "fail",
        detail: "property.visible === false → excluida del catálogo.",
      });
    } else {
      steps.push({
        step: "flag-visible",
        verdict: "pass",
        detail: `visible=${property.visible ?? "(unset, OK)"}`,
      });
    }

    // 4. Filtro de ubicación (loc en property.location).
    const propLocLower = String(property.location ?? "").toLowerCase();
    const matchesLoc = propLocLower.includes(locLower);
    steps.push({
      step: "filtro-ubicación",
      verdict: matchesLoc ? "pass" : "fail",
      detail: matchesLoc
        ? `property.location="${property.location}" contiene "${args.location}".`
        : `property.location="${property.location}" NO contiene "${args.location}". Esto la excluye del catálogo en esta búsqueda.`,
    });

    // 5. Filtro de capacidad.
    const eventEff = catalogPeopleCountForFilter(property, args.isEvento);
    const sleepCap = Math.max(0, Number(property.capacity ?? 0));
    const minOk = args.cupo > 0 ? eventEff >= args.cupo : true;
    steps.push({
      step: "filtro-capacidad-min",
      verdict: minOk ? "pass" : "fail",
      detail: `effectivePeopleCount=${eventEff} ${minOk ? ">=" : "<"} cupo solicitado=${args.cupo}. (sleepCapacity=${sleepCap}${args.isEvento ? ", eventCapacity=" + (property.eventCapacity ?? "unset") : ""})`,
    });
    steps.push({
      step: "filtro-capacidad-max",
      verdict: "info",
      detail: `sleepCapacity=${sleepCap}. Para descanso, el techo estricto es cupo+buffer (cupo 13 → max 19) y el relajado ~1.7x (max 23). Para eventos NO se aplica techo. Sin pasar el techo, la pasada estricta o relajada la incluye; con el nuevo pase "loc+minOnly+ev" se incluye independiente del techo.`,
    });

    // 6. Filtro de eventos (familyOnly / allowsEventsContent).
    if (args.isEvento === true) {
      if (property.familyOnly === true) {
        steps.push({
          step: "filtro-evento",
          verdict: "info",
          detail: "property.familyOnly=true. Anteriormente la excluía; ahora `matchesEvento` devuelve true siempre, así que NO se filtra.",
        });
      } else if (property.allowsEventsContent === false) {
        steps.push({
          step: "filtro-evento",
          verdict: "info",
          detail: "property.allowsEventsContent=false. Anteriormente la excluía; ahora `matchesEvento` devuelve true siempre, así que NO se filtra.",
        });
      } else {
        steps.push({
          step: "filtro-evento",
          verdict: "pass",
          detail: "Cumple filtros de evento (allowsEventsContent y familyOnly).",
        });
      }
    } else {
      steps.push({
        step: "filtro-evento",
        verdict: "info",
        detail: "Búsqueda no-evento → `matchesEvento` no aplica restricciones.",
      });
    }

    return {
      steps,
      property: {
        id: property._id,
        title: property.title,
        location: property.location,
        capacity: property.capacity,
        eventCapacity: property.eventCapacity,
        familyOnly: property.familyOnly,
        allowsEventsContent: property.allowsEventsContent,
        active: property.active,
        visible: property.visible,
        // Campos que aparecen en el resumen del bot. Si están en 0 o null,
        // NO se muestran en la cotización.
        priceBase: property.priceBase,
        depositoDanosReembolsable: property.depositoDanosReembolsable ?? null,
        manillaCondominio: property.manillaCondominio ?? null,
      },
      link: link
        ? { productRetailerId: link.productRetailerId, catalogId: link.catalogId }
        : null,
    };
  },
});
