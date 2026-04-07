/**
 * Utility for transcribing audio from a URL using OpenAI Whisper.
 * Used for WhatsApp/YCloud voice messages.
 */

export async function transcribeAudio(audioUrl: string, prompt?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[transcription] OPENAI_API_KEY not configured");
    throw new Error("OPENAI_API_KEY no configurada");
  }

  try {
    console.log("[transcription] Descargando audio...");
    
    // 1. Fetch the audio file
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      throw new Error(`Error al descargar el audio: ${audioRes.statusText}`);
    }
    
    const audioBlob = await audioRes.blob();
    const arrayBuffer = await audioBlob.arrayBuffer();

    // 2. Prepare for OpenAI Whisper
    const formData = new FormData();
    const file = new File([arrayBuffer], "audio.ogg", { type: audioRes.headers.get("Content-Type") || "audio/ogg" });
    
    formData.append("file", file);
    formData.append("model", "whisper-1");
    // Language hint to improve accuracy (Spanish)
    formData.append("language", "es");
    
    // Contextual prompt to improve accuracy on domain-specific words
    if (prompt) {
      formData.append("prompt", prompt);
    }

    console.log("[transcription] Enviando a OpenAI Whisper con prompt dental...");
    const transcriptionRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!transcriptionRes.ok) {
      const errorData = await transcriptionRes.json().catch(() => ({}));
      console.error("[transcription] OpenAI Error:", errorData);
      throw new Error(`OpenAI Whisper Error: ${transcriptionRes.statusText}`);
    }

    const data = await transcriptionRes.json() as { text: string };
    console.log("[transcription] Éxito:", data.text.substring(0, 50) + "...");
    
    return data.text.trim();
  } catch (error) {
    console.error("[transcription] Error in transcribeAudio:", error);
    throw error;
  }
}
