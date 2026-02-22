/**
 * Lee fincas de la base de datos de 10 en 10 y las muestra en texto natural
 * 
 * Uso:
 *   node scripts/leer-fincas.js 0      -> primeras 10
 *   node scripts/leer-fincas.js 10     -> siguientes 10
 *   node scripts/leer-fincas.js 20     -> siguientes 10
 * 
 * O con query:
 *   node scripts/leer-fincas.js 0 "azulejos"  -> busca "azulejos" en las primeras 10
 */

const axios = require("axios");

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const LIMIT = 10;
const offset = Number(process.argv[2] || 0);
const query = process.argv[3] || null;

// ---------- Helpers ----------
function cleanSpaces(s) {
  if (s == null) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

// Detecta si el campo tiene rangos tipo "COP 1,900,000 1-16 ... COP 2,200,000 17-23"
function parseRangosPrecio(text) {
  if (!text) return null;
  const raw = String(text).replace(/\u00A0/g, " ").trim(); // NBSP -> space
  const t = raw.replace(/\s+/g, " ");

  // Caso simple: si no hay "1-" o "17-" etc, lo devolvemos tal cual
  const hasRange = /\b\d+\s*-\s*\d+\b/.test(t);
  if (!hasRange) return { type: "simple", value: raw };

  // Buscamos pares: (precio) + (rango)
  const regex = /((?:COP|\$)?\s*[\d.,]+)\s*(\d+\s*-\s*\d+)/gi;

  const matches = [];
  let m;
  while ((m = regex.exec(t)) !== null) {
    matches.push({
      precio: m[1].trim(),
      rango: m[2].replace(/\s+/g, ""),
    });
  }

  if (matches.length === 0) return { type: "simple", value: raw };

  return { type: "rangos", items: matches };
}

function formatPrecioCampo(label, value) {
  const v = cleanSpaces(value);
  if (!v) return null;

  const parsed = parseRangosPrecio(v);
  if (!parsed) return null;

  if (parsed.type === "simple") {
    return `• ${label}: ${parsed.value}`;
  }

  if (parsed.type === "rangos") {
    const lines = parsed.items.map(
      (it) => `   - ${it.rango} personas: ${it.precio}`
    );
    return `• ${label}:\n${lines.join("\n")}`;
  }

  return `• ${label}: ${v}`;
}

function formatPricingItem(pricingItem) {
  const nombre = cleanSpaces(pricingItem.nombre);
  const fechaDesde = pricingItem.fechaDesde ? cleanSpaces(pricingItem.fechaDesde) : null;
  const fechaHasta = pricingItem.fechaHasta ? cleanSpaces(pricingItem.fechaHasta) : null;
  const valorUnico = pricingItem.valorUnico;
  const condiciones = pricingItem.condiciones ? JSON.parse(pricingItem.condiciones) : null;
  const reglas = pricingItem.reglas ? JSON.parse(pricingItem.reglas) : null;

  const bloques = [];

  // Nombre y fechas
  let header = `📅 ${nombre}`;
  if (fechaDesde || fechaHasta) {
    const fechas = [fechaDesde, fechaHasta].filter(Boolean).join(" - ");
    header += ` (${fechas})`;
  }
  bloques.push(header);

  // Reglas descriptivas (si existen)
  if (reglas && reglas.descripcion) {
    bloques.push(`   📋 Reglas: ${reglas.descripcion}`);
  }

  // Precios
  if (valorUnico) {
    bloques.push(`   💰 Precio único: $${Number(valorUnico).toLocaleString("es-CO")}`);
  } else if (condiciones && Array.isArray(condiciones)) {
    const precios = [];
    for (const cond of condiciones) {
      if (cond.valorUnico) {
        precios.push(`   💰 ${cond.tipo}: $${Number(cond.valorUnico).toLocaleString("es-CO")}`);
      } else if (cond.preciosPorRango && Array.isArray(cond.preciosPorRango)) {
        const rangos = cond.preciosPorRango.map(
          (p) => `      - ${p.personas} personas: $${Number(p.cop).toLocaleString("es-CO")}`
        );
        precios.push(`   💰 ${cond.tipo}:\n${rangos.join("\n")}`);
      }
    }
    if (precios.length > 0) {
      bloques.push(precios.join("\n"));
    }
  }

  return bloques.join("\n");
}

function formatFincaNatural(f) {
  const nombre = cleanSpaces(f.title);
  const municipio = cleanSpaces(f.location);
  const descripcion = f.description ? String(f.description).trim() : "";
  const servicios = f.features && Array.isArray(f.features) ? f.features.join(", ") : "";

  const bloques = [];

  // Encabezado
  bloques.push(`🏡 ${nombre}`);
  if (municipio) bloques.push(`📍 Municipio: ${municipio}`);
  if (f.code) bloques.push(`🔖 Código: ${f.code}`);

  // Texto
  if (descripcion) {
    bloques.push(`\n📝 Descripción:\n${descripcion}`);
  }
  if (servicios) {
    bloques.push(`\n✅ Servicios:\n${servicios}`);
  }

  // Pricing (temporadas)
  if (f.pricing && Array.isArray(f.pricing) && f.pricing.length > 0) {
    bloques.push(`\n💰 Precios por Temporada:\n`);
    f.pricing.forEach((p) => {
      bloques.push(formatPricingItem(p));
      bloques.push(""); // línea en blanco entre temporadas
    });
  } else {
    bloques.push(`\n💰 Precios: (sin datos estructurados)`);
    // Fallback a campos legacy si existen
    const preciosLegacy = [];
    if (f.priceBase) preciosLegacy.push(`• Precio base: $${Number(f.priceBase).toLocaleString("es-CO")}`);
    if (f.priceBaja) preciosLegacy.push(`• Temporada baja: $${Number(f.priceBaja).toLocaleString("es-CO")}`);
    if (f.priceMedia) preciosLegacy.push(`• Temporada media: $${Number(f.priceMedia).toLocaleString("es-CO")}`);
    if (f.priceAlta) preciosLegacy.push(`• Temporada alta: $${Number(f.priceAlta).toLocaleString("es-CO")}`);
    if (f.priceEspeciales) preciosLegacy.push(`• Fechas especiales: $${Number(f.priceEspeciales).toLocaleString("es-CO")}`);
    if (preciosLegacy.length > 0) {
      bloques.push(preciosLegacy.join("\n"));
    }
  }

  return bloques.join("\n");
}

// ---------- Main ----------
async function main() {
  try {
    let url;
    if (query) {
      url = `${API_BASE}/api/fincas/search?q=${encodeURIComponent(query)}&limit=${LIMIT}`;
    } else {
      // Para paginación simple, obtenemos más resultados y luego cortamos
      // Nota: El API usa cursor, pero para simplificar obtenemos más y paginamos manualmente
      const totalToFetch = offset + LIMIT;
      url = `${API_BASE}/api/fincas?limit=${totalToFetch}`;
    }

    const { data } = await axios.get(url);

    const fincas = Array.isArray(data) ? data : (data.items || data.fincas || []);

    // Paginación manual
    const fincasPaginated = fincas.slice(offset, offset + LIMIT);

    if (!fincasPaginated.length) {
      console.log("No hay más resultados para ese offset.");
      return;
    }

    console.log(`\nMostrando ${fincasPaginated.length} fincas (offset ${offset}, limit ${LIMIT})`);
    if (fincas.length > offset + LIMIT) {
      console.log(`   (Total disponible: ${fincas.length}, quedan ${fincas.length - offset - LIMIT} más)\n`);
    } else {
      console.log(`   (Total disponible: ${fincas.length})\n`);
    }

    fincasPaginated.forEach((f, i) => {
      console.log("=".repeat(90));
      console.log(`#${offset + i + 1}`);
      console.log(formatFincaNatural(f));
      console.log("=".repeat(90));
      console.log();
    });

    if (fincas.length > offset + LIMIT) {
      console.log(`\n💡 Para ver las siguientes 10: node scripts/leer-fincas.js ${offset + LIMIT}`);
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    if (err.response) {
      console.error("   Respuesta API:", JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
