"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexFincas = exports.search = exports.deleteFile = exports.addText = exports.addFile = exports.getPendingUpload = exports.deletePendingUpload = exports.processUpload = exports.enqueueFile = exports.list = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const rag_1 = require("@convex-dev/rag");
const server_2 = require("convex/server");
const extractTextContent_1 = require("./lib/extractTextContent");
const rag_2 = __importDefault(require("./rag"));
const api_1 = require("./_generated/api");
const DEFAULT_NAMESPACE = 'fincas';
function guessMimeType(filename, bytes) {
    return ((0, rag_1.guessMimeTypeFromExtension)(filename) ||
        (0, rag_1.guessMimeTypeFromContents)(bytes) ||
        'application/octet-stream');
}
function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
function toArrayBuffer(bytes) {
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    return ab;
}
async function convertEntryToPublicFile(ctx, entry) {
    const metadata = entry.metadata;
    const storageId = metadata?.storageId;
    let fileSize = 'unknown';
    if (storageId) {
        try {
            const storageMetadata = await ctx.db.system.get(storageId);
            if (storageMetadata) {
                fileSize = formatFileSize(storageMetadata.size);
            }
        }
        catch (error) {
            console.log('Failed to get storage metadata: ', error);
        }
    }
    const filename = entry.key || 'Unknown';
    const extension = filename.split('.').pop()?.toLowerCase() || 'txt';
    let status = 'error';
    if (entry.status === 'ready') {
        status = 'ready';
    }
    else if (entry.status === 'pending') {
        status = 'processing';
    }
    const url = storageId ? await ctx.storage.getUrl(storageId) : null;
    return {
        id: entry.entryId,
        name: filename,
        type: extension,
        size: fileSize,
        status,
        url,
        category: metadata?.category ?? undefined,
    };
}
function formatFileSize(bytes) {
    if (bytes === 0) {
        return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}
exports.list = (0, server_1.query)({
    args: {
        namespace: values_1.v.optional(values_1.v.string()),
        category: values_1.v.optional(values_1.v.string()),
        paginationOpts: server_2.paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
            throw new values_1.ConvexError({
                code: 'UNAUTHORIZED',
                message: 'Debes iniciar sesión para listar el conocimiento',
            });
        }
        const namespace = args.namespace ?? DEFAULT_NAMESPACE;
        const ns = await rag_2.default.getNamespace(ctx, { namespace });
        if (!ns) {
            return { page: [], isDone: true, continueCursor: '' };
        }
        const results = await rag_2.default.list(ctx, {
            namespaceId: ns.namespaceId,
            paginationOpts: args.paginationOpts,
        });
        const files = await Promise.all(results.page.map((entry) => convertEntryToPublicFile(ctx, entry)));
        const filteredFiles = args.category
            ? files.filter((file) => file.category === args.category)
            : files;
        return {
            page: filteredFiles,
            isDone: results.isDone,
            continueCursor: results.continueCursor,
        };
    },
});
exports.enqueueFile = (0, server_1.mutation)({
    args: {
        storageId: values_1.v.id('_storage'),
        filename: values_1.v.string(),
        mimeType: values_1.v.string(),
        category: values_1.v.optional(values_1.v.string()),
        namespace: values_1.v.string(),
        userId: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        const jobId = await ctx.db.insert('pendingKnowledgeUploads', {
            storageId: args.storageId,
            filename: args.filename,
            mimeType: args.mimeType,
            category: args.category,
            namespace: args.namespace,
            userId: args.userId,
            createdAt: Date.now(),
        });
        await ctx.scheduler.runAfter(0, api_1.api.knowledge.processUpload, { jobId });
        return { jobId };
    },
});
exports.processUpload = (0, server_1.action)({
    args: { jobId: values_1.v.id('pendingKnowledgeUploads') },
    handler: async (ctx, args) => {
        const job = await ctx.runQuery(api_1.api.knowledge.getPendingUpload, {
            jobId: args.jobId,
        });
        if (!job)
            return;
        const { storageId, filename, mimeType, category, namespace, userId } = job;
        const url = await ctx.storage.getUrl(storageId);
        if (!url) {
            await ctx.runMutation(api_1.api.knowledge.deletePendingUpload, {
                jobId: args.jobId,
            });
            return;
        }
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        const mimeResolved = mimeType || guessMimeType(filename, arrayBuffer);
        const text = await (0, extractTextContent_1.extractTextContent)(ctx, {
            storageId,
            filename,
            bytes: arrayBuffer,
            mimeType: mimeResolved,
        });
        const contentHash = await (0, rag_1.contentHashFromArrayBuffer)(arrayBuffer);
        const { created } = await rag_2.default.add(ctx, {
            namespace,
            text,
            key: filename,
            title: filename,
            metadata: {
                storageId,
                uploadedBy: userId,
                filename,
                category: category ?? null,
            },
            contentHash,
        });
        if (!created) {
            await ctx.storage.delete(storageId);
        }
        await ctx.runMutation(api_1.api.knowledge.deletePendingUpload, {
            jobId: args.jobId,
        });
    },
});
exports.deletePendingUpload = (0, server_1.mutation)({
    args: { jobId: values_1.v.id('pendingKnowledgeUploads') },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.jobId);
    },
});
exports.getPendingUpload = (0, server_1.query)({
    args: { jobId: values_1.v.id('pendingKnowledgeUploads') },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.jobId);
    },
});
exports.addFile = (0, server_1.action)({
    args: {
        filename: values_1.v.string(),
        mimeType: values_1.v.string(),
        bytesBase64: values_1.v.string(),
        category: values_1.v.optional(values_1.v.string()),
        namespace: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
            throw new values_1.ConvexError({
                code: 'UNAUTHORIZED',
                message: 'Debes iniciar sesión para subir documentos',
            });
        }
        const namespace = args.namespace ?? DEFAULT_NAMESPACE;
        const userId = identity.subject;
        const bytes = base64ToBytes(args.bytesBase64);
        const arrayBuffer = toArrayBuffer(bytes);
        const { filename, category } = args;
        const mimeType = args.mimeType || guessMimeType(filename, arrayBuffer);
        const blob = new Blob([arrayBuffer], { type: mimeType });
        const storageId = await ctx.storage.store(blob);
        const result = await ctx.runMutation(api_1.api.knowledge.enqueueFile, {
            storageId,
            filename,
            mimeType,
            category,
            namespace,
            userId,
        });
        const jobId = result.jobId;
        return {
            jobId,
            storageId,
            status: 'processing',
            url: await ctx.storage.getUrl(storageId),
            message: 'Archivo subido. La indexación continúa en segundo plano; el documento aparecerá en la lista cuando esté listo.',
        };
    },
});
exports.addText = (0, server_1.action)({
    args: {
        title: values_1.v.string(),
        text: values_1.v.string(),
        category: values_1.v.optional(values_1.v.string()),
        namespace: values_1.v.optional(values_1.v.string()),
        key: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
            throw new values_1.ConvexError({
                code: 'UNAUTHORIZED',
                message: 'Debes iniciar sesión para añadir contenido',
            });
        }
        const namespace = args.namespace ?? DEFAULT_NAMESPACE;
        const userId = identity.subject;
        const { entryId, created } = await rag_2.default.add(ctx, {
            namespace,
            text: args.text,
            key: args.key ?? args.title,
            title: args.title,
            metadata: {
                uploadedBy: userId,
                filename: args.title,
                category: args.category ?? null,
            },
        });
        return { entryId, created };
    },
});
exports.deleteFile = (0, server_1.mutation)({
    args: { entryId: rag_1.vEntryId },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
            throw new values_1.ConvexError({
                code: 'UNAUTHORIZED',
                message: 'Debes iniciar sesión para eliminar documentos',
            });
        }
        const namespace = await rag_2.default.getNamespace(ctx, {
            namespace: DEFAULT_NAMESPACE,
        });
        if (!namespace) {
            throw new values_1.ConvexError({
                code: 'NOT_FOUND',
                message: 'Namespace no encontrado',
            });
        }
        const entry = await rag_2.default.getEntry(ctx, { entryId: args.entryId });
        if (!entry) {
            throw new values_1.ConvexError({
                code: 'NOT_FOUND',
                message: 'Documento no encontrado',
            });
        }
        const metadata = entry.metadata;
        if (metadata?.storageId) {
            await ctx.storage.delete(metadata.storageId);
        }
        await rag_2.default.deleteAsync(ctx, {
            entryId: args.entryId,
        });
    },
});
exports.search = (0, server_1.action)({
    args: {
        query: values_1.v.string(),
        namespace: values_1.v.optional(values_1.v.string()),
        limit: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
            throw new values_1.ConvexError({
                code: 'UNAUTHORIZED',
                message: 'Debes iniciar sesión para buscar en el conocimiento',
            });
        }
        const namespace = args.namespace ?? DEFAULT_NAMESPACE;
        const limit = args.limit ?? 10;
        const searchResult = await rag_2.default.search(ctx, {
            namespace,
            query: args.query,
            limit,
        });
        return {
            text: searchResult.text,
            entries: searchResult.entries.map((e) => ({
                entryId: e.entryId,
                title: e.title ?? e.key,
            })),
        };
    },
});
exports.indexFincas = (0, server_1.action)({
    args: {
        namespace: values_1.v.optional(values_1.v.string()),
        propertyIds: values_1.v.optional(values_1.v.array(values_1.v.id('properties'))),
        limit: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
            throw new values_1.ConvexError({
                code: 'UNAUTHORIZED',
                message: 'Debes iniciar sesión para indexar fincas',
            });
        }
        const namespace = args.namespace ?? DEFAULT_NAMESPACE;
        const userId = identity.subject;
        let listResult;
        if (args.propertyIds?.length) {
            const props = await Promise.all(args.propertyIds.map((id) => ctx.runQuery(api_1.api.fincas.getById, { id })));
            listResult = {
                properties: props
                    .filter((p) => p != null)
                    .map((p) => ({
                    _id: p._id,
                    title: p.title,
                    description: p.description,
                    location: p.location,
                    capacity: p.capacity,
                    type: p.type,
                    category: p.category,
                    features: p.features,
                })),
            };
        }
        else {
            const result = await ctx.runQuery(api_1.api.fincas.list, {
                limit: args.limit ?? 100,
            });
            listResult = {
                properties: result.properties.map((p) => ({
                    _id: p._id,
                    title: p.title,
                    description: p.description,
                    location: p.location,
                    capacity: p.capacity,
                    type: p.type,
                    category: p.category,
                    features: p.features,
                })),
            };
        }
        const indexed = [];
        for (const prop of listResult.properties) {
            const text = [
                `Título: ${prop.title}`,
                `Descripción: ${prop.description}`,
                `Ubicación: ${prop.location}`,
                `Capacidad: ${prop.capacity} personas`,
                `Tipo: ${prop.type}`,
                `Categoría: ${prop.category}`,
                prop.features?.length
                    ? `Características: ${prop.features.map((f) => f.name).join(', ')}`
                    : '',
            ]
                .filter(Boolean)
                .join('\n');
            const { entryId } = await rag_2.default.add(ctx, {
                namespace,
                text,
                key: `finca-${prop._id}`,
                title: prop.title,
                metadata: {
                    uploadedBy: userId,
                    filename: prop.title,
                    category: 'finca',
                },
            });
            indexed.push(entryId);
        }
        return { indexed: indexed.length, entryIds: indexed };
    },
});
//# sourceMappingURL=knowledge.js.map