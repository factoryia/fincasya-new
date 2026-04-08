import { type EntryId } from '@convex-dev/rag';
import type { Id } from './_generated/dataModel';
export type KnowledgeFile = {
    id: EntryId;
    name: string;
    type: string;
    size: string;
    status: 'ready' | 'processing' | 'error';
    url: string | null;
    category?: string;
};
export declare const list: import("convex/server").RegisteredQuery<"public", {
    category?: string;
    namespace?: string;
    paginationOpts: {
        id?: number;
        endCursor?: string | null;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: string | null;
    };
}, Promise<{
    page: KnowledgeFile[];
    isDone: boolean;
    continueCursor: string;
}>>;
export declare const enqueueFile: import("convex/server").RegisteredMutation<"public", {
    category?: string;
    filename: string;
    userId: string;
    mimeType: string;
    namespace: string;
    storageId: import("convex/values").GenericId<"_storage">;
}, Promise<{
    jobId: import("convex/values").GenericId<"pendingKnowledgeUploads">;
}>>;
export declare const processUpload: import("convex/server").RegisteredAction<"public", {
    jobId: import("convex/values").GenericId<"pendingKnowledgeUploads">;
}, Promise<void>>;
export declare const deletePendingUpload: import("convex/server").RegisteredMutation<"public", {
    jobId: import("convex/values").GenericId<"pendingKnowledgeUploads">;
}, Promise<void>>;
export declare const getPendingUpload: import("convex/server").RegisteredQuery<"public", {
    jobId: import("convex/values").GenericId<"pendingKnowledgeUploads">;
}, Promise<{
    _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
    _creationTime: number;
    category?: string;
    filename: string;
    userId: string;
    mimeType: string;
    namespace: string;
    createdAt: number;
    storageId: import("convex/values").GenericId<"_storage">;
}>>;
type AddFileResult = {
    jobId: Id<'pendingKnowledgeUploads'>;
    storageId: Id<'_storage'>;
    status: 'processing';
    url: string | null;
    message: string;
};
export declare const addFile: import("convex/server").RegisteredAction<"public", {
    category?: string;
    namespace?: string;
    filename: string;
    mimeType: string;
    bytesBase64: string;
}, Promise<AddFileResult>>;
export declare const addText: import("convex/server").RegisteredAction<"public", {
    category?: string;
    key?: string;
    namespace?: string;
    text: string;
    title: string;
}, Promise<{
    entryId: string & {
        _: "EntryId";
    };
    created: boolean;
}>>;
export declare const deleteFile: import("convex/server").RegisteredMutation<"public", {
    entryId: string & {
        _: "EntryId";
    };
}, Promise<void>>;
export declare const search: import("convex/server").RegisteredAction<"public", {
    limit?: number;
    namespace?: string;
    query: string;
}, Promise<{
    text: string;
    entries: {
        entryId: string & {
            _: "EntryId";
        };
        title: string;
    }[];
}>>;
export declare const indexFincas: import("convex/server").RegisteredAction<"public", {
    limit?: number;
    propertyIds?: import("convex/values").GenericId<"properties">[];
    namespace?: string;
}, Promise<{
    indexed: number;
    entryIds: string[];
}>>;
export {};
