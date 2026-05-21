/**
 * Clasificador de imágenes para el flujo de contrato del bot de WhatsApp.
 *
 * Cuando el cliente está en la fase de contrato y manda una imagen, el bot
 * NO debería adivinar a ciegas qué es. Esta utilidad usa un modelo de visión
 * de OpenAI para clasificar la imagen en:
 *   "cedula"      — foto de un documento de identidad (cédula / pasaporte).
 *   "comprobante" — soporte / comprobante de pago o transferencia bancaria.
 *   "otro"        — cualquier otra cosa (foto irrelevante, texto a mano, etc.).
 *
 * Devuelve `null` si NO se pudo analizar (sin API key, error de red, respuesta
 * inesperada). El llamador trata `null` como "no sé" → escala a un asesor
 * (comportamiento seguro), en vez de pedirle al cliente que reenvíe algo que
 * sí mandó.
 */

export type ContractImageKind = "cedula" | "comprobante" | "otro";

export async function classifyContractImage(
  imageUrl: string,
): Promise<ContractImageKind | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !imageUrl) return null;

  const prompt = [
    "Eres un clasificador de imágenes para una empresa de alquiler de fincas en Colombia.",
    "El cliente está cerrando el contrato y debería enviar la FOTO DE SU CÉDULA",
    "(documento de identidad colombiano).",
    "",
    "Mira la imagen y responde con UNA sola palabra, sin nada más:",
    '  cedula      → si es una cédula, documento de identidad o pasaporte (cualquier lado).',
    '  comprobante → si es un comprobante/soporte de pago, transferencia o recibo bancario.',
    '  otro        → cualquier otra cosa (foto no relacionada, texto manuscrito, captura, etc.).',
    "",
    "Responde únicamente: cedula, comprobante u otro.",
  ].join("\n");

  try {
    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 10,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!apiRes.ok) {
      console.error(
        "[imageClassifier] OpenAI error:",
        apiRes.status,
        apiRes.statusText,
      );
      return null;
    }

    const data = (await apiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = String(data.choices?.[0]?.message?.content ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .trim();

    if (raw.includes("cedula")) return "cedula";
    if (raw.includes("comprobante")) return "comprobante";
    if (raw.includes("otro")) return "otro";
    return null;
  } catch (error) {
    console.error("[imageClassifier] Error en classifyContractImage:", error);
    return null;
  }
}
