"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeAudio = transcribeAudio;
async function transcribeAudio(audioUrl, prompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error("[transcription] OPENAI_API_KEY not configured");
        throw new Error("OPENAI_API_KEY no configurada");
    }
    try {
        console.log("[transcription] Descargando audio...");
        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok) {
            throw new Error(`Error al descargar el audio: ${audioRes.statusText}`);
        }
        const audioBlob = await audioRes.blob();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const formData = new FormData();
        const file = new File([arrayBuffer], "audio.ogg", { type: audioRes.headers.get("Content-Type") || "audio/ogg" });
        formData.append("file", file);
        formData.append("model", "whisper-1");
        formData.append("language", "es");
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
        const data = await transcriptionRes.json();
        console.log("[transcription] Éxito:", data.text.substring(0, 50) + "...");
        return data.text.trim();
    }
    catch (error) {
        console.error("[transcription] Error in transcribeAudio:", error);
        throw error;
    }
}
//# sourceMappingURL=transcription.js.map