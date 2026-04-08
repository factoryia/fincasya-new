export declare const sendMessage: import("convex/server").RegisteredAction<"public", {
    metadata?: any;
    text?: string;
    mediaUrl?: string;
    mediaUrlForStorage?: string;
    filename?: string;
    type: "text" | "image" | "audio" | "document" | "product";
    conversationId: import("convex/values").GenericId<"conversations">;
    phone: string;
}, Promise<{
    ok: boolean;
}>>;
