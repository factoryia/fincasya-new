/**
 * Modelo de chat OpenAI usado en Convex (respuestas WhatsApp, clasificadores, visión, extracción).
 *
 * Por defecto: `gpt-5.4` (modelo insignia actual en la API; mejor razonamiento que mini).
 * Alternativas comunes (según tu cuenta y presupuesto):
 * - `gpt-5.4-pro` — máxima calidad / razonamiento más profundo
 * - `gpt-5.4-mini` — más barato y rápido, buen equilibrio
 * - `gpt-5.1` u otros alias — solo si aparecen en tu dashboard de OpenAI
 * - `gpt-4o` — respaldo si tu API key aún no tiene acceso a la familia 5.4
 *
 * Override: `npx convex env set OPENAI_CONVEX_MODEL gpt-5.4-pro`
 */
export const CONVEX_OPENAI_CHAT_MODEL =
  process.env.OPENAI_CONVEX_MODEL?.trim() || "gpt-5.4";
