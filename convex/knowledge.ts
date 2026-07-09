import { ConvexError, v } from 'convex/values';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  QueryCtx,
} from './_generated/server';
import {
  contentHashFromArrayBuffer,
  type Entry,
  type EntryId,
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  vEntryId,
} from '@convex-dev/rag';
import { paginationOptsValidator } from 'convex/server';
import { extractTextContent } from './lib/extractTextContent';
import { FAQ_INITIAL_SEED } from './lib/faqSeed';
import { PLAYBOOK_NAMESPACE } from './lib/playbookSeed';
import rag from './rag';
import type { Id } from './_generated/dataModel';
import { api, internal } from './_generated/api';

const DEFAULT_NAMESPACE = 'fincas';

/**
 * Namespace separado para preguntas frecuentes que el bot puede consultar:
 * políticas (mascotas, abono, RNT), reglas operativas (horarios, check-in/out),
 * formas de pago, condiciones de cancelación, etc.
 *
 * Se mantiene aparte de "fincas" para que las búsquedas del bot devuelvan info
 * de políticas y no descripciones de propiedades.
 */
export const FAQ_NAMESPACE = 'faq';

// El namespace del playbook (`PLAYBOOK_NAMESPACE`) vive en `./lib/playbookSeed`
// para evitar ciclos de import (lo comparten `searchPlaybookForBot` aquí y el
// CRUD admin en `convex/playbook.ts`).

// La semilla de FAQs (`FAQ_INITIAL_SEED`) vive en `./lib/faqSeed` — fuente
// única de verdad. `knowledge.ts` la siembra en el RAG; `inbound.ts` la usa
// como fallback determinístico (`localFaqFallback`) si el RAG falla.
// Para añadir/modificar una FAQ: edita `./lib/faqSeed.ts` y corre
// `bunx convex run knowledge:seedFaqEntries`.

function guessMimeType(filename: string, bytes: ArrayBuffer): string {
  return (
    guessMimeTypeFromExtension(filename) ||
    guessMimeTypeFromContents(bytes) ||
    'application/octet-stream'
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
  status: 'ready' | 'processing' | 'error';
  url: string | null;
  category?: string;
};

type EntryMetadata = {
  storageId?: Id<'_storage'>;
  uploadedBy: string;
  filename: string;
  category: string | null;
};

async function convertEntryToPublicFile(
  ctx: QueryCtx,
  entry: Entry,
): Promise<KnowledgeFile> {
  const metadata = entry.metadata as EntryMetadata | undefined;
  const storageId = metadata?.storageId;

  let fileSize = 'unknown';

  if (storageId) {
    try {
      const storageMetadata = await ctx.db.system.get(storageId);
      if (storageMetadata) {
        fileSize = formatFileSize(storageMetadata.size);
      }
    } catch (error) {
      console.log('Failed to get storage metadata: ', error);
    }
  }

  const filename = entry.key || 'Unknown';
  const extension = filename.split('.').pop()?.toLowerCase() || 'txt';

  let status: 'ready' | 'processing' | 'error' = 'error';
  if (entry.status === 'ready') {
    status = 'ready';
  } else if (entry.status === 'pending') {
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
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
        code: 'UNAUTHORIZED',
        message: 'Debes iniciar sesión para listar el conocimiento',
      });
    }

    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const ns = await rag.getNamespace(ctx, { namespace });

    if (!ns) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const results = await rag.list(ctx, {
      namespaceId: ns.namespaceId,
      paginationOpts: args.paginationOpts,
    });

    const files = await Promise.all(
      results.page.map((entry) => convertEntryToPublicFile(ctx, entry)),
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
    storageId: v.id('_storage'),
    filename: v.string(),
    mimeType: v.string(),
    category: v.optional(v.string()),
    namespace: v.string(),
    userId: v.string(),
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
    await ctx.scheduler.runAfter(0, api.knowledge.processUpload, { jobId });
    return { jobId };
  },
});

/**
 * Procesa una subida encolada: extrae texto, vectoriza y añade al RAG.
 * Se ejecuta en background (programado por enqueueFile).
 */
export const processUpload = action({
  args: { jobId: v.id('pendingKnowledgeUploads') },
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
    const mimeResolved = mimeType || guessMimeType(filename, arrayBuffer);

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
  args: { jobId: v.id('pendingKnowledgeUploads') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.jobId);
  },
});

/** Devuelve el estado de una subida (para que el cliente haga poll). */
export const getPendingUpload = query({
  args: { jobId: v.id('pendingKnowledgeUploads') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

/** Resultado de addFile (procesamiento en background). */
type AddFileResult = {
  jobId: Id<'pendingKnowledgeUploads'>;
  storageId: Id<'_storage'>;
  status: 'processing';
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

    const result = await ctx.runMutation(api.knowledge.enqueueFile, {
      storageId,
      filename,
      mimeType,
      category,
      namespace,
      userId,
    });

    const jobId = result.jobId as Id<'pendingKnowledgeUploads'>;

    return {
      jobId,
      storageId,
      status: 'processing',
      url: await ctx.storage.getUrl(storageId),
      message:
        'Archivo subido. La indexación continúa en segundo plano; el documento aparecerá en la lista cuando esté listo.',
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
        code: 'UNAUTHORIZED',
        message: 'Debes iniciar sesión para añadir contenido',
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
        code: 'UNAUTHORIZED',
        message: 'Debes iniciar sesión para eliminar documentos',
      });
    }

    const namespace = await rag.getNamespace(ctx, {
      namespace: DEFAULT_NAMESPACE,
    });

    if (!namespace) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Namespace no encontrado',
      });
    }

    const entry = await rag.getEntry(ctx, { entryId: args.entryId });

    if (!entry) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Documento no encontrado',
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
        code: 'UNAUTHORIZED',
        message: 'Debes iniciar sesión para buscar en el conocimiento',
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
    propertyIds: v.optional(v.array(v.id('properties'))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new ConvexError({
        code: 'UNAUTHORIZED',
        message: 'Debes iniciar sesión para indexar fincas',
      });
    }

    const namespace = args.namespace ?? DEFAULT_NAMESPACE;
    const userId = identity.subject;

    // Obtener fincas: si hay propertyIds usarlas, si no listar con límite
    let listResult: {
      properties: Array<{
        _id: Id<'properties'>;
        title: string;
        description: string;
        location: string;
        capacity: number;
        eventCapacity?: number;
        eventPackagePrice?: number;
        allowsEventsContent?: boolean;
        type: string;
        category: string;
        features?: { name: string; iconUrl: string | null }[];
      }>;
    };
    if (args.propertyIds?.length) {
      const props = await Promise.all(
        args.propertyIds.map((id) => ctx.runQuery(api.fincas.getById, { id })),
      );
      type PropRow = {
        _id: Id<'properties'>;
        title: string;
        description: string;
        location: string;
        capacity: number;
        eventCapacity?: number;
        eventPackagePrice?: number;
        allowsEventsContent?: boolean;
        type: string;
        category: string;
        features?: { name: string; iconUrl: string | null }[];
      };
      listResult = {
        properties: (props as (PropRow | null)[])
          .filter((p): p is PropRow => p != null)
          .map((p: PropRow) => ({
            _id: p._id,
            title: p.title,
            description: p.description,
            location: p.location,
            capacity: p.capacity,
            eventCapacity: p.eventCapacity,
            eventPackagePrice: p.eventPackagePrice,
            allowsEventsContent: p.allowsEventsContent,
            type: p.type,
            category: p.category,
            features: p.features,
          })),
      };
    } else {
      const result = await ctx.runQuery(api.fincas.list, {
        limit: args.limit ?? 100,
      });
      type PropRow = {
        _id: Id<'properties'>;
        title: string;
        description: string;
        location: string;
        capacity: number;
        eventCapacity?: number;
        eventPackagePrice?: number;
        allowsEventsContent?: boolean;
        type: string;
        category: string;
        features?: { name: string; iconUrl: string | null }[];
      };
      listResult = {
        properties: result.properties.map((p: PropRow) => ({
          _id: p._id,
          title: p.title,
          description: p.description,
          location: p.location,
          capacity: p.capacity,
          eventCapacity: p.eventCapacity,
          eventPackagePrice: p.eventPackagePrice,
          allowsEventsContent: p.allowsEventsContent,
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
        `Capacidad hospedaje: ${prop.capacity} personas`,
        prop.allowsEventsContent === true &&
          prop.eventCapacity != null &&
          prop.eventCapacity > 0
          ? `Capacidad para evento/invitados: hasta ${prop.eventCapacity} personas`
          : '',
        prop.allowsEventsContent === true &&
          prop.eventCapacity != null &&
          prop.eventCapacity > 0 &&
          prop.eventPackagePrice != null &&
          prop.eventPackagePrice > 0
          ? `Precio de referencia para evento (hasta ${prop.eventCapacity} invitados): ${prop.eventPackagePrice.toLocaleString('es-CO')} COP`
          : '',
        `Tipo: ${prop.type}`,
        `Categoría: ${prop.category}`,
        prop.features?.length
          ? `Características: ${prop.features.map((f) => f.name).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const { entryId } = await rag.add(ctx, {
        namespace,
        text,
        key: `finca-${prop._id}`,
        title: prop.title,
        metadata: {
          uploadedBy: userId,
          filename: prop.title,
          category: 'finca',
        } as EntryMetadata,
      });

      indexed.push(entryId);
    }

    return { indexed: indexed.length, entryIds: indexed };
  },
});

/**
 * Búsqueda RAG para el bot de WhatsApp (sin auth de usuario).
 *
 * Diferencias clave con `search`:
 *   - No requiere `ctx.auth.getUserIdentity()` (el bot corre en webhook).
 *   - Usa por defecto el namespace `"faq"` (no `"fincas"`), así no mezcla
 *     descripciones de propiedades con políticas operativas.
 *   - Devuelve un texto plano listo para inyectar en el system prompt,
 *     más una lista corta de títulos para referencia.
 *
 * El bot la invoca desde `inbound.ts` cuando detecta que el cliente preguntó
 * algo tipo FAQ (ver `looksLikeQuestion`). Si no hay matches con score
 * suficiente, devuelve `text: ""` y el bot sigue su flujo normal.
 */
export const searchFaqForBot = action({
  args: {
    query: v.string(),
    namespace: v.optional(v.string()),
    /** Score mínimo para considerar el match válido. Default 0.5 (suficientemente conservador
     *  para evitar matches espurios sin requerir reranker). El componente `@convex-dev/rag`
     *  devuelve scores de similitud de coseno aproximados (~0-1). */
    minScore: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    /** Texto del entry TOP-1 (no concatenación). Vacío si no hubo match >= minScore. */
    text: string;
    /** Título del entry TOP-1 (vacío si no hubo match válido). */
    title: string;
    /** Score del top match (0 si no hubo). Útil para el caller. */
    score: number;
  }> => {
    const query = String(args.query ?? '').trim();
    if (query.length < 3) return { text: '', title: '', score: 0 };

    const namespace = args.namespace ?? FAQ_NAMESPACE;
    // Default minScore = 0.35 (antes 0.5). Bajamos el umbral porque las
    // preguntas coloquiales del cliente ("que horarios ahi", "y los horarios?",
    // "como es el abono") tienen embedding similarity moderada vs. los títulos
    // formales del FAQ ("Horarios de check-in entrada y salida"). Con 0.5
    // perdíamos matches válidos. text-embedding-3-small típicamente devuelve
    // 0.3-0.7 para matches relevantes; 0.35 es un balance entre cobertura y
    // ruido. Si surgen falsos positivos, subir; si siguen faltando matches,
    // bajar más.
    const minScore = args.minScore ?? 0.35;

    try {
      const searchResult = await rag.search(ctx, {
        namespace,
        query,
        // Pedimos hasta 4 chunks porque un mismo entry puede tener varios chunks
        // pequeños; filtramos al top entry abajo.
        limit: 4,
      });

      const results = searchResult.results ?? [];
      const top = results[0];
      if (!top || top.score < minScore) {
        return { text: '', title: '', score: top?.score ?? 0 };
      }

      // Solo nos quedamos con los chunks del TOP entry (mismo entryId que el top).
      // Si el RAG devolvió chunks de otros entries detrás, se descartan: queremos
      // UN solo bloque temático, no una concatenación de FAQs distintas.
      const topEntryId = top.entryId;
      const chunksFromTopEntry = results
        .filter((r) => r.entryId === topEntryId)
        // ordenarlos por su `order` para reconstruir el texto en su orden original
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .flatMap((r) => r.content ?? [])
        .map((c) => String(c.text ?? '').trim())
        .filter((t) => t.length > 0);

      const text = chunksFromTopEntry.join('\n').trim();
      const topEntry = (searchResult.entries ?? []).find(
        (e) => e.entryId === topEntryId,
      );
      const title = String(topEntry?.title ?? topEntry?.key ?? '').trim();

      return { text, title, score: top.score };
    } catch (err) {
      console.error('searchFaqForBot fallo:', err);
      return { text: '', title: '', score: 0 };
    }
  },
});

/**
 * Siembra (idempotente) las FAQs iniciales en el namespace `"faq"`.
 *
 * Uso típico (una sola vez tras desplegar, o al añadir nuevas entradas):
 *   bunx convex run knowledge:seedFaqEntries
 *
 * El `key` es estable por entrada, así que correrlo varias veces no duplica:
 * el RAG reusa el entry existente si el contenido coincide.
 *
 * Para añadir o modificar FAQs sin editar este archivo, también está disponible
 * `addText` (UI autenticada) — solo asegúrate de pasar `namespace: "faq"`.
 */
export const seedFaqEntries = action({
  args: {
    namespace: v.optional(v.string()),
    /** Si se pasa, se siembran solo estas entradas (override del seed por defecto). */
    entries: v.optional(
      v.array(
        v.object({
          key: v.string(),
          title: v.string(),
          text: v.string(),
        }),
      ),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ inserted: number; reused: number; keys: string[] }> => {
    const namespace = args.namespace ?? FAQ_NAMESPACE;
    const entries = args.entries ?? FAQ_INITIAL_SEED;
    const keys: string[] = [];
    let inserted = 0;
    let reused = 0;

    for (const entry of entries) {
      const { created } = await rag.add(ctx, {
        namespace,
        text: entry.text,
        key: entry.key,
        title: entry.title,
        metadata: {
          uploadedBy: 'system:seed',
          filename: entry.title,
          category: 'faq',
        } as EntryMetadata,
      });
      keys.push(entry.key);
      if (created) inserted += 1;
      else reused += 1;
    }

    return { inserted, reused, keys };
  },
});

/**
 * Búsqueda del PLAYBOOK DE TONO para el bot (sin auth — corre en webhook).
 *
 * A diferencia de `searchFaqForBot` (que recupera HECHOS), esto recupera
 * EJEMPLOS DE ESTILO: cómo respondería el equipo en una situación parecida a la
 * del cliente. El texto que devuelve se inyecta en el system prompt como
 * referencia de tono (few-shot), NO como datos ni como instrucción de flujo.
 *
 * - Embebemos situación + frases del cliente → matchea el mensaje entrante.
 * - Preferimos ejemplos de la MISMA fase del FSM (con relleno de fase "any");
 *   los de otra fase concreta se descartan para no contaminar el flujo.
 * - Umbral 0.30 (más laxo que el FAQ): el tono matchea situaciones, no datos.
 */
export const searchPlaybookForBot = action({
  args: {
    query: v.string(),
    /** Fase actual del FSM (para preferir ejemplos de la misma etapa). */
    phase: v.optional(v.string()),
    minScore: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ text: string; count: number }> => {
    const query = String(args.query ?? '').trim();
    if (query.length < 3) return { text: '', count: 0 };

    const minScore = args.minScore ?? 0.3;
    const wantPhase = String(args.phase ?? '').trim();

    try {
      const searchResult = await rag.search(ctx, {
        namespace: PLAYBOOK_NAMESPACE,
        query,
        // Traemos varios y filtramos por fase abajo (corpus pequeño).
        limit: args.limit ?? 8,
      });

      const results = searchResult.results ?? [];
      const entries = searchResult.entries ?? [];

      // Mejor score por entry (un entry puede tener varios chunks).
      const bestScoreByEntry = new Map<string, number>();
      for (const r of results) {
        const prev = bestScoreByEntry.get(r.entryId) ?? -1;
        if (r.score > prev) bestScoreByEntry.set(r.entryId, r.score);
      }

      // Lee un campo string de metadata de forma segura (metadata es
      // `Record<string, unknown>`; evita `no-base-to-string` sobre `unknown`).
      const readStr = (v: unknown): string =>
        typeof v === 'string' ? v.trim() : '';

      type Candidate = {
        score: number;
        phase: string;
        situation: string;
        response: string;
      };
      const candidates: Candidate[] = entries
        .map((e): Candidate => {
          const md = (e.metadata ?? {}) as Record<string, unknown>;
          return {
            score: bestScoreByEntry.get(e.entryId) ?? 0,
            phase: readStr(md.phase) || 'any',
            situation: readStr(md.situation) || readStr(e.title),
            response: readStr(md.response),
          };
        })
        .filter((c) => c.response.length > 0 && c.score >= minScore);

      // Preferimos MISMA fase; rellenamos con "any". Otras fases concretas se
      // descartan a propósito (evita copiar el fraseo de otra etapa del flujo).
      const byScore = (a: Candidate, b: Candidate): number => b.score - a.score;
      const samePhase = candidates
        .filter((c) => c.phase === wantPhase)
        .sort(byScore);
      const anyPhase = candidates
        .filter((c) => c.phase === 'any' && c.phase !== wantPhase)
        .sort(byScore);
      const chosen = [...samePhase, ...anyPhase].slice(0, 2);

      if (chosen.length === 0) return { text: '', count: 0 };

      const text = chosen
        .map(
          (c, i) =>
            `Ejemplo ${i + 1} — situación: ${c.situation}\nAsí lo diría el equipo:\n"${c.response}"`,
        )
        .join('\n\n———\n\n');

      return { text, count: chosen.length };
    } catch (err) {
      console.error('searchPlaybookForBot fallo:', err);
      return { text: '', count: 0 };
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints para el panel admin (sin auth de usuario Convex).
//
// Se usan desde `convex/http.ts` con protección `X-API-Key` (la misma del
// resto del admin / panel). Comparten la lógica con las versiones públicas
// autenticadas pero saltan el `ctx.auth.getUserIdentity()`, porque la auth
// ya se valida a nivel HTTP en el handler.
// ─────────────────────────────────────────────────────────────────────────────

/** Listar entradas (paginado) — versión admin. */
export const listForAdmin = internalQuery({
  args: {
    namespace: v.string(),
    category: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<{
    page: KnowledgeFile[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const ns = await rag.getNamespace(ctx, { namespace: args.namespace });
    if (!ns) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const results = await rag.list(ctx, {
      namespaceId: ns.namespaceId,
      paginationOpts: args.paginationOpts,
    });
    const files = await Promise.all(
      results.page.map((entry) => convertEntryToPublicFile(ctx, entry)),
    );
    const filtered = args.category
      ? files.filter((file) => file.category === args.category)
      : files;
    return {
      page: filtered,
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

const MAX_ENTRY_TEXT_CHARS = 400_000;

/** Texto indexado (chunks) + metadatos — solo admin HTTP (X-API-Key). */
export const getEntryContentForAdmin = internalQuery({
  args: {
    namespace: v.string(),
    entryId: vEntryId,
  },
  handler: async (ctx, args) => {
    const ns = await rag.getNamespace(ctx, { namespace: args.namespace });
    if (!ns) return null;

    const entry = await rag.getEntry(ctx, { entryId: args.entryId });
    if (!entry) return null;

    const metadata = entry.metadata as EntryMetadata | undefined;
    let downloadUrl: string | null = null;
    if (metadata?.storageId) {
      try {
        downloadUrl = await ctx.storage.getUrl(metadata.storageId);
      } catch {
        downloadUrl = null;
      }
    }

    const parts: string[] = [];
    let cursor: string | null = null;
    let totalChars = 0;
    for (let pageIdx = 0; pageIdx < 200; pageIdx++) {
      const chunkPage = await rag.listChunks(ctx, {
        entryId: args.entryId,
        paginationOpts: { numItems: 80, cursor },
        order: 'asc',
      });
      for (const ch of chunkPage.page) {
        const t = ch.text ?? '';
        if (totalChars + t.length > MAX_ENTRY_TEXT_CHARS) {
          const slice = t.slice(0, Math.max(0, MAX_ENTRY_TEXT_CHARS - totalChars));
          if (slice) parts.push(slice);
          totalChars = MAX_ENTRY_TEXT_CHARS;
          break;
        }
        parts.push(t);
        totalChars += t.length;
      }
      if (totalChars >= MAX_ENTRY_TEXT_CHARS) break;
      if (chunkPage.isDone) break;
      cursor = chunkPage.continueCursor;
      if (!cursor) break;
    }

    const fullText = parts.join('\n\n').trim();
    const truncated = totalChars >= MAX_ENTRY_TEXT_CHARS;

    return {
      entryId: args.entryId,
      key: entry.key ?? null,
      title: entry.title ?? null,
      category: metadata?.category ?? null,
      status: entry.status,
      fullText,
      truncated,
      downloadUrl,
    };
  },
});

/**
 * Sube un archivo (bytes en base64) — versión admin sin auth.
 * Encola el procesamiento en background y devuelve el jobId para que la UI
 * pueda hacer poll del estado vía `getPendingUpload`.
 */
export const addFileForAdmin = internalAction({
  args: {
    filename: v.string(),
    mimeType: v.string(),
    bytesBase64: v.string(),
    category: v.optional(v.string()),
    namespace: v.string(),
    /** Identificador opcional para auditoría. Default "admin:panel". */
    uploadedBy: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    jobId: Id<'pendingKnowledgeUploads'>;
    storageId: Id<'_storage'>;
    status: 'processing';
    url: string | null;
  }> => {
    const bytes = base64ToBytes(args.bytesBase64);
    const arrayBuffer = toArrayBuffer(bytes);
    const mimeType = args.mimeType || guessMimeType(args.filename, arrayBuffer);
    const blob = new Blob([arrayBuffer], { type: mimeType });
    const storageId = await ctx.storage.store(blob);

    const result = await ctx.runMutation(api.knowledge.enqueueFile, {
      storageId,
      filename: args.filename,
      mimeType,
      category: args.category,
      namespace: args.namespace,
      userId: args.uploadedBy ?? 'admin:panel',
    });

    return {
      jobId: result.jobId as Id<'pendingKnowledgeUploads'>,
      storageId,
      status: 'processing' as const,
      url: await ctx.storage.getUrl(storageId),
    };
  },
});

/** Añade texto plano al RAG — versión admin sin auth. */
export const addTextForAdmin = internalAction({
  args: {
    title: v.string(),
    text: v.string(),
    category: v.optional(v.string()),
    namespace: v.string(),
    key: v.optional(v.string()),
    uploadedBy: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ entryId: string; created: boolean }> => {
    const { entryId, created } = await rag.add(ctx, {
      namespace: args.namespace,
      text: args.text,
      key: args.key ?? args.title,
      title: args.title,
      metadata: {
        uploadedBy: args.uploadedBy ?? 'admin:panel',
        filename: args.title,
        category: args.category ?? null,
      } as EntryMetadata,
    });
    return { entryId: entryId as string, created };
  },
});

/** Elimina una entrada del RAG (y su archivo asociado en storage si existe). */
export const deleteForAdmin = internalAction({
  args: {
    entryId: vEntryId,
    namespace: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const ns = await rag.getNamespace(ctx, { namespace: args.namespace });
    if (!ns) throw new Error('Namespace no encontrado');

    const entry = await rag.getEntry(ctx, { entryId: args.entryId });
    if (!entry) throw new Error('Entrada no encontrada');

    const metadata = entry.metadata as EntryMetadata | undefined;
    if (metadata?.storageId) {
      await ctx.storage.delete(metadata.storageId);
    }

    await rag.deleteAsync(ctx, { entryId: args.entryId });
    return { ok: true as const };
  },
});

/** Estado de un job de procesamiento (para poll desde el front). */
export const getJobStatusForAdmin = internalQuery({
  args: { jobId: v.id('pendingKnowledgeUploads') },
  handler: async (
    ctx,
    args,
  ): Promise<{ exists: boolean }> => {
    const job = await ctx.db.get(args.jobId);
    return { exists: job != null };
  },
});

// Mantén el `internal` import vivo para futuros usos.
void internal;
void internalMutation;
