/**
 * Carga masiva de fincas desde Excel "A tabla de precios.xlsx"
 * Usa el endpoint de importación: POST /api/fincas/import
 * Este endpoint usa el parser mejorado que detecta temporadas, condiciones y reglas
 *
 * Uso:
 *   1. Coloca el archivo "A tabla de precios.xlsx" en la raíz del proyecto (o en scripts/)
 *   2. API corriendo: pnpm run start:dev
 *   3. pnpm run importar-fincas
 *
 * Opcional: variable de entorno COOKIE con las cookies de sesión si la API requiere auth
 */

const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const EXCEL_PATH = process.env.EXCEL_PATH || path.join(__dirname, "..", "A tabla de precios.xlsx");

// ---------- API ----------
async function importarExcel(filePath, cookie) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const headers = {
    ...formData.getHeaders(),
    ...(cookie && { Cookie: cookie }),
  };

  const { data, status } = await axios({
    method: "POST",
    url: `${API_BASE}/api/fincas/import`,
    headers,
    data: formData,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  if (status < 200 || status >= 300) {
    throw new Error(`API ${status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// ---------- Main ----------
async function importar() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error("❌ No se encontró el archivo:", EXCEL_PATH);
    console.error("   Crea la variable EXCEL_PATH o coloca 'A tabla de precios.xlsx' en la raíz.");
    process.exit(1);
  }

  const cookie = process.env.COOKIE || "";

  try {
    console.log("📄 Archivo Excel:", EXCEL_PATH);
    console.log("🌐 API:", API_BASE);
    console.log("📤 Enviando archivo al endpoint de importación...\n");

    const resultado = await importarExcel(EXCEL_PATH, cookie);

    console.log("\n🎉 Importación finalizada.");
    console.log("   ✅ Fincas creadas:", resultado.created || 0);
    console.log("   ⏭️  Omitidas:", resultado.skipped || 0);
    console.log("   ❌ Errores:", resultado.errors || 0);
    
    if (resultado.details && Array.isArray(resultado.details)) {
      console.log("\n📋 Detalles:");
      resultado.details.forEach((detail) => {
        console.log(`   ${detail}`);
      });
    }
  } catch (e) {
    console.error("❌ Error:", e.message);
    if (e.response) {
      console.error("   Respuesta API:", JSON.stringify(e.response.data, null, 2));
    }
    process.exit(1);
  }
}

importar();
