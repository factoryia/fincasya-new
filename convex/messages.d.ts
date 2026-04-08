export declare const insertUserMessage: import("convex/server").RegisteredMutation<"internal", {
    metadata?: any;
    type?: "text" | "image" | "audio" | "document" | "product" | "video";
    mediaUrl?: string;
    conversationId: import("convex/values").GenericId<"conversations">;
    createdAt: number;
    content: string;
}, Promise<void>>;
export declare const insertAssistantMessage: import("convex/server").RegisteredMutation<"internal", {
    conversationId: import("convex/values").GenericId<"conversations">;
    createdAt: number;
    content: string;
}, Promise<void>>;
export declare const insertAssistantMessageWithMedia: import("convex/server").RegisteredMutation<"internal", {
    metadata?: any;
    type?: "text" | "image" | "audio" | "document" | "product" | "video";
    mediaUrl?: string;
    conversationId: import("convex/values").GenericId<"conversations">;
    createdAt: number;
    content: string;
}, Promise<void>>;
export declare const listRecent: import("convex/server").RegisteredQuery<"public", {
    limit?: number;
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<{
    _id: import("convex/values").GenericId<"messages">;
    _creationTime: number;
    metadata?: any;
    type?: "text" | "image" | "audio" | "document" | "product" | "video";
    mediaUrl?: string;
    conversationId: import("convex/values").GenericId<"conversations">;
    createdAt: number;
    sender: "user" | "assistant";
    content: string;
}[]>>;
export declare const updateMessageContent: import("convex/server").RegisteredMutation<"internal", {
    content: string;
    messageId: import("convex/values").GenericId<"messages">;
}, Promise<void>>;
