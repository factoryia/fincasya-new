"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = require("@ai-sdk/openai");
const rag_1 = require("@convex-dev/rag");
const api_1 = require("./_generated/api");
const rag = new rag_1.RAG(api_1.components.rag, {
    textEmbeddingModel: openai_1.openai.embedding("text-embedding-3-small"),
    embeddingDimension: 1536,
});
exports.default = rag;
//# sourceMappingURL=rag.js.map