import type { StorageActionWriter } from "convex/server";
import type { Id } from "../_generated/dataModel";
export type ExtractTextContentArgs = {
    storageId: Id<"_storage">;
    filename: string;
    bytes?: ArrayBuffer;
    mimeType: string;
};
export declare function extractTextContent(ctx: {
    storage: StorageActionWriter;
}, args: ExtractTextContentArgs): Promise<string>;
