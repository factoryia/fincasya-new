"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTextContent = extractTextContent;
const openai_1 = require("@ai-sdk/openai");
const ai_1 = require("ai");
const convex_helpers_1 = require("convex-helpers");
const AI_MODELS = {
    image: openai_1.openai.chat("gpt-5-mini"),
    pdf: openai_1.openai.chat("gpt-4o"),
    html: openai_1.openai.chat("gpt-4o"),
};
const SUPPORTED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
];
const SYSTEM_PROMPTS = {
    image: "You turn images into text. If it is a photo of a document, transcribe it. If it is not a document, describe it.",
    pdf: "You transform PDF files into text.",
    html: "You transform content into markdown.",
};
async function extractTextContent(ctx, args) {
    const { filename, mimeType, storageId, bytes } = args;
    const url = await ctx.storage.getUrl(storageId);
    (0, convex_helpers_1.assert)(url, "Failed to get storage URL");
    if (SUPPORTED_IMAGE_TYPES.some((type) => type === mimeType)) {
        return extractImageText(url);
    }
    if (mimeType.toLowerCase().includes("pdf")) {
        return extractPdfText(url, mimeType, filename);
    }
    if (mimeType.toLowerCase().includes("text") || mimeType.toLowerCase().includes("json") || mimeType.toLowerCase().includes("markdown")) {
        return extractTextFileContent(ctx, storageId, bytes, mimeType);
    }
    throw new Error(`Unsupported MIME type ${mimeType}`);
}
async function extractImageText(url) {
    const result = await (0, ai_1.generateText)({
        model: AI_MODELS.image,
        system: SYSTEM_PROMPTS.image,
        messages: [
            {
                role: "user",
                content: [{ type: "image", image: new URL(url) }],
            },
        ],
    });
    return result.text;
}
async function extractPdfText(url, mimeType, filename) {
    const result = await (0, ai_1.generateText)({
        model: AI_MODELS.pdf,
        system: SYSTEM_PROMPTS.pdf,
        messages: [
            {
                role: "user",
                content: [
                    { type: "file", data: new URL(url), mimeType, filename },
                    {
                        type: "text",
                        text: "Extract the text from the PDF and print it without explaining you'll do so.",
                    },
                ],
            },
        ],
    });
    return result.text;
}
async function extractTextFileContent(ctx, storageId, bytes, mimeType) {
    const arrayBuffer = bytes || (await (await ctx.storage.get(storageId))?.arrayBuffer());
    if (!arrayBuffer) {
        throw new Error("Failed to get file content");
    }
    const text = new TextDecoder().decode(arrayBuffer);
    if (mimeType.toLowerCase() !== "text/plain") {
        const result = await (0, ai_1.generateText)({
            model: AI_MODELS.html,
            system: SYSTEM_PROMPTS.html,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text },
                        {
                            type: "text",
                            text: "Extract the text and print it in a markdown format without explaining that you'll do so.",
                        },
                    ],
                },
            ],
        });
        return result.text;
    }
    return text;
}
//# sourceMappingURL=extractTextContent.js.map