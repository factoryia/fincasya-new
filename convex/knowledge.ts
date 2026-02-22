import { ConvexError, v } from "convex/values";
import { action, mutation, query, QueryCtx } from "./_generated/server";
import {
  contentHashFromArrayBuffer,
  type Entry,
  type EntryId,
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  vEntryId,
} from "@convex-dev/rag";
import { paginationOptsValidator } from "convex/server";
import { extractTextContent } from "./lib/extractTextContent";
import rag from "./rag";
import type { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";

const DEFAULT_NAMESPACE = "fincas";

function guessMimeType(filename: string, bytes: ArrayBuffer): string {
  return (
    guessMimeTypeFromExtension(filename) ||
    guessMimeTypeFromContents(bytes) ||
    "application/octet-stream"
  );
}

/** Decodifica base64 a bytes (para recibir archivos por la API HTTP, que solo envía JSON). */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Convierte Uint8Array a ArrayBuffer (copia para garantizar tipo ArrayBuffer). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

export type KnowledgeFile = {
  id: EntryId;
  name: string;
  type: string;
  size: string;
  status: "ready" | "processing" | "error";
  url: string | null;
  category?: string;
};

type EntryMetadata = {
  storageId?: Id<"_storage">;
  uploadedBy: string;
  filename: string;
  category: string | null;
};

async function convertEntryToPublicFile(
  ctx: QueryCtx,
  entry: Entry
): Promise<KnowledgeFile> {
  const metadata = entry.metadata as EntryMetadata | undefined;
  const storageId = metadata?.storageId;

  let fileSize = "unknown";

  if (storageId) {
    try {
      const storageMetadata = await ctx.db.system.get(storageId);
      if (storageMetadata) {
        fileSize = formatFileSize(storageMetadata.size);
      }
    } catch (error) {
      console.log("Failed to get storage metadata: ", error);
    }
  }

  const filename = entry.key || "Unknown";
  const extension = filename.split(".").pop()?.toLowerCase() || "txt";

  let status: "ready" | "processing" | "error" = "error";
  if (entry.status === "ready") {
    status = "ready";
  } else if (entry.status === "pending") {
    status = "processing";
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

/**
 * Listar documentos de la base de conocimiento (vectorizada).
 * Namespace por defecto: "fincas". Opcionalmente por usuario.
 */
export const list = query({
  args: {
    namespace: v.optional(v.string()),
    category: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Debes iniciar sesión para listar el conocimiento",
      });
    }

    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const ns = await rag.getNamespace(ctx, { namespace });

    if (!ns) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const results = await rag.list(ctx, {
      namespaceId: ns.namespaceId,
      paginationOpts: args.paginationOpts,
    });

    const files = await Promise.all(
      results.page.map((entry) => convertEntryToPublicFile(ctx, entry))
    );

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

/**
 * Encola una subida para procesamiento en background (evita timeout 524).
 * Solo se llama desde addFile.
 */
export const enqueueFile = mutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    category: v.optional(v.string()),
    namespace: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("pendingKnowledgeUploads", {
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      category: args.category,
      namespace: args.namespace,
      userId: args.userId,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, api.knowledge.processUpload, { jobId });
    return { jobId };
  },
});

/**
 * Procesa una subida encolada: extrae texto, vectoriza y añade al RAG.
 * Se ejecuta en background (programado por enqueueFile).
 */
export const processUpload = action({
  args: { jobId: v.id("pendingKnowledgeUploads") },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(api.knowledge.getPendingUpload, {
      jobId: args.jobId,
    });
    if (!job) return;

    const { storageId, filename, mimeType, category, namespace, userId } = job;
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      await ctx.runMutation(api.knowledge.deletePendingUpload, {
        jobId: args.jobId,
      });
      return;
    }

    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    const mimeResolved =
      mimeType ||
      guessMimeType(filename, arrayBuffer);

    const text = await extractTextContent(ctx, {
      storageId,
      filename,
      bytes: arrayBuffer,
      mimeType: mimeResolved,
    });

    const contentHash = await contentHashFromArrayBuffer(arrayBuffer);
    const { created } = await rag.add(ctx, {
      namespace,
      text,
      key: filename,
      title: filename,
      metadata: {
        storageId,
        uploadedBy: userId,
        filename,
        category: category ?? null,
      } as EntryMetadata,
      contentHash,
    });

    if (!created) {
      await ctx.storage.delete(storageId);
    }

    await ctx.runMutation(api.knowledge.deletePendingUpload, {
      jobId: args.jobId,
    });
  },
});

/** Elimina un job de la cola (tras procesar o si falla). */
export const deletePendingUpload = mutation({
  args: { jobId: v.id("pendingKnowledgeUploads") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.jobId);
  },
});

/** Devuelve el estado de una subida (para que el cliente haga poll). */
export const getPendingUpload = query({
  args: { jobId: v.id("pendingKnowledgeUploads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

/** Resultado de addFile (procesamiento en background). */
type AddFileResult = {
  jobId: Id<"pendingKnowledgeUploads">;
  storageId: Id<"_storage">;
  status: "processing";
  url: string | null;
  message: string;
};

/**
 * Añadir un documento a la base de conocimiento (procesamiento en background).
 * Solo guarda el archivo en storage y encola el job; la extracción y vectorización
 * se hacen en segundo plano para evitar timeout 524.
 */
export const addFile = action({
  args: {
    filename: v.string(),
    mimeType: v.string(),
    bytesBase64: v.string(),
    category: v.optional(v.string()),
    namespace: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AddFileResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Debes iniciar sesión para subir documentos",
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

    const result = await ctx.runMutation(api.knowledge.enqueueFile, {
      storageId,
      filename,
      mimeType,
      category,
      namespace,
      userId,
    });

    const jobId = result.jobId as Id<"pendingKnowledgeUploads">;

    return {
      jobId,
      storageId,
      status: "processing",
      url: await ctx.storage.getUrl(storageId),
      message:
        "Archivo subido. La indexación continúa en segundo plano; el documento aparecerá en la lista cuando esté listo.",
    };
  },
});

/**
 * Añadir texto directo a la base de conocimiento (sin archivo).
 * Útil para indexar descripciones de fincas o reglas de negocio.
 */
export const addText = action({
  args: {
    title: v.string(),
    text: v.string(),
    category: v.optional(v.string()),
    namespace: v.optional(v.string()),
    key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Debes iniciar sesión para añadir contenido",
      });
    }

    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const userId = identity.subject;

    const { entryId, created } = await rag.add(ctx, {
      namespace,
      text: args.text,
      key: args.key ?? args.title,
      title: args.title,
      metadata: {
        uploadedBy: userId,
        filename: args.title,
        category: args.category ?? null,
      } as EntryMetadata,
    });

    return { entryId, created };
  },
});

/**
 * Eliminar un documento de la base de conocimiento.
 */
export const deleteFile = mutation({
  args: { entryId: vEntryId },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Debes iniciar sesión para eliminar documentos",
      });
    }

    const namespace = await rag.getNamespace(ctx, {
      namespace: DEFAULT_NAMESPACE,
    });

    if (!namespace) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Namespace no encontrado",
      });
    }

    const entry = await rag.getEntry(ctx, { entryId: args.entryId });

    if (!entry) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Documento no encontrado",
      });
    }

    const metadata = entry.metadata as EntryMetadata | undefined;
    if (metadata?.storageId) {
      await ctx.storage.delete(metadata.storageId);
    }

    await rag.deleteAsync(ctx, {
      entryId: args.entryId,
    });
  },
});

/**
 * Búsqueda semántica en la base de conocimiento (vectorizada).
 * Devuelve los fragmentos más relevantes para la consulta.
 */
export const search = action({
  args: {
    query: v.string(),
    namespace: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Debes iniciar sesión para buscar en el conocimiento",
      });
    }

    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const limit = args.limit ?? 10;

    const searchResult = await rag.search(ctx, {
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

/**
 * Indexar todas las fincas (o por IDs) en la base de conocimiento RAG.
 * Crea un documento por finca con título, descripción, ubicación y características.
 */
export const indexFincas = action({
  args: {
    namespace: v.optional(v.string()),
    propertyIds: v.optional(v.array(v.id("properties"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Debes iniciar sesión para indexar fincas",
      });
    }

    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const userId = identity.subject;

    // Obtener fincas: si hay propertyIds usarlas, si no listar con límite
    let listResult: { properties: Array<{ _id: Id<"properties">; title: string; description: string; location: string; capacity: number; type: string; category: string; features?: string[] }> };
    if (args.propertyIds?.length) {
      const props = await Promise.all(
        args.propertyIds.map((id) => ctx.runQuery(api.fincas.getById, { id }))
      );
      type PropRow = { _id: Id<"properties">; title: string; description: string; location: string; capacity: number; type: string; category: string; features?: string[] };
      listResult = {
        properties: (props as (PropRow | null)[])
          .filter((p): p is PropRow => p != null)
          .map((p: PropRow) => ({
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
    } else {
      const result = await ctx.runQuery(api.fincas.list, {
        limit: args.limit ?? 100,
      });
      type PropRow = { _id: Id<"properties">; title: string; description: string; location: string; capacity: number; type: string; category: string; features?: string[] };
      listResult = {
        properties: result.properties.map((p: PropRow) => ({
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

    const indexed: string[] = [];

    for (const prop of listResult.properties) {
      const text = [
        `Título: ${prop.title}`,
        `Descripción: ${prop.description}`,
        `Ubicación: ${prop.location}`,
        `Capacidad: ${prop.capacity} personas`,
        `Tipo: ${prop.type}`,
        `Categoría: ${prop.category}`,
        prop.features?.length ? `Características: ${prop.features.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const { entryId } = await rag.add(ctx, {
        namespace,
        text,
        key: `finca-${prop._id}`,
        title: prop.title,
        metadata: {
          uploadedBy: userId,
          filename: prop.title,
          category: "finca",
        } as EntryMetadata,
      });

      indexed.push(entryId);
    }

    return { indexed: indexed.length, entryIds: indexed };
  },
});
