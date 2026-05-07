import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function extractContractDataFromHistory(fullHistory: string) {

  const { text } = await generateText({
    model: openai("gpt-4.1-mini"),
    system: `Extrae datos del cliente para el contrato de arrendamiento de finca.
Devuelve SOLO JSON con estos campos (omite los que no estén en el historial):
{
  "nombre": string,
  "cedula": string,
  "ciudad_expedicion": string,
  "email": string,
  "telefono": string,
  "direccion": string,
  "finca": string,
  "checkInDate": "YYYY-MM-DD",
  "checkOutDate": "YYYY-MM-DD",
  "personas": number,
  "mascotas": number
}`,
    messages: [{ role: "user", content: fullHistory }],
    temperature: 0,
    maxTokens: 500,
  });

  try {
    const jsonStr = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}
