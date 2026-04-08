export declare const updateLastMessageAt: import("convex/server").RegisteredMutation<"internal", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const setLastCatalogSent: import("convex/server").RegisteredMutation<"internal", {
    minCapacity?: number;
    sortByPrice?: boolean;
    fechaEntrada: number;
    fechaSalida: number;
    conversationId: import("convex/values").GenericId<"conversations">;
    location: string;
    propertyIds: import("convex/values").GenericId<"properties">[];
}, Promise<void>>;
export declare const escalate: import("convex/server").RegisteredMutation<"internal", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const setToAi: import("convex/server").RegisteredMutation<"internal", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const resolve: import("convex/server").RegisteredMutation<"internal", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const getById: import("convex/server").RegisteredQuery<"public", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<{
    _id: import("convex/values").GenericId<"conversations">;
    _creationTime: number;
    attended?: boolean;
    priority?: "resolved" | "urgent" | "low" | "medium";
    lastMessageAt?: number;
    lastSentCatalogPropertyIds?: import("convex/values").GenericId<"properties">[];
    lastCatalogSearch?: {
        minCapacity?: number;
        sortByPrice?: boolean;
        fechaEntrada: number;
        fechaSalida: number;
        location: string;
    };
    status: "ai" | "human" | "resolved";
    contactId: import("convex/values").GenericId<"contacts">;
    createdAt: number;
    channel: "whatsapp";
}>>;
export declare const escalateToHuman: import("convex/server").RegisteredMutation<"public", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const markAsAttended: import("convex/server").RegisteredMutation<"public", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const setToAiPublic: import("convex/server").RegisteredMutation<"public", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const resolveConversation: import("convex/server").RegisteredMutation<"public", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const setPriority: import("convex/server").RegisteredMutation<"public", {
    priority: "resolved" | "urgent" | "low" | "medium";
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<void>>;
export declare const list: import("convex/server").RegisteredQuery<"public", {
    status?: "ai" | "human" | "resolved";
    attended?: boolean;
    priority?: "resolved" | "urgent" | "low" | "medium";
    limit?: number;
}, Promise<{
    contact: {
        phone: string;
        name: string;
    };
    _id: import("convex/values").GenericId<"conversations">;
    _creationTime: number;
    attended?: boolean;
    priority?: "resolved" | "urgent" | "low" | "medium";
    lastMessageAt?: number;
    lastSentCatalogPropertyIds?: import("convex/values").GenericId<"properties">[];
    lastCatalogSearch?: {
        minCapacity?: number;
        sortByPrice?: boolean;
        fechaEntrada: number;
        fechaSalida: number;
        location: string;
    };
    status: "ai" | "human" | "resolved";
    contactId: import("convex/values").GenericId<"contacts">;
    createdAt: number;
    channel: "whatsapp";
}[]>>;
