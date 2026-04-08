export declare function isAffirmativeOnly(userMessage: string): boolean;
export declare function isProvidingFollowUpData(userMessage: string): boolean;
export declare function isNegativeOnly(userMessage: string): boolean;
export declare const recordProcessedEvent: import("convex/server").RegisteredMutation<"internal", {
    eventId: string;
}, Promise<{
    duplicate: boolean;
}>>;
export declare const getOrCreateContact: import("convex/server").RegisteredMutation<"internal", {
    name: string;
    phone: string;
}, Promise<import("convex/values").GenericId<"contacts">>>;
export declare const getOrCreateConversation: import("convex/server").RegisteredMutation<"internal", {
    contactId: import("convex/values").GenericId<"contacts">;
}, Promise<{
    conversationId: import("convex/values").GenericId<"conversations">;
    isNew: boolean;
}>>;
export declare const processInboundMessage: import("convex/server").RegisteredAction<"internal", {
    type?: "text" | "image" | "audio" | "document" | "video";
    mediaUrl?: string;
    wamid?: string;
    name: string;
    text: string;
    phone: string;
    eventId: string;
}, Promise<void>>;
export declare const generateReplyWithRagAndFincas: import("convex/server").RegisteredAction<"internal", {
    singleFincaCatalogSent?: boolean;
    fincaTitle?: string;
    searchQueryOverride?: string;
    whatsappCatalogSentForSearch?: boolean;
    dynamicLocations?: string;
    catalogLocation?: string;
    catalogFincasCount?: number;
    catalogFoundFincasButFailed?: boolean;
    imageUrl?: string;
    conversationId: import("convex/values").GenericId<"conversations">;
    userMessage: string;
}, Promise<string>>;
export declare const markOutboundAsHuman: import("convex/server").RegisteredMutation<"internal", {
    phone: string;
}, Promise<void>>;
export declare const sendWhatsAppMessage: import("convex/server").RegisteredAction<"internal", {
    wamid?: string;
    sendDirectly?: boolean;
    text: string;
    to: string;
}, Promise<any>>;
export type RoutableWhatsappTemplate = {
    name: string;
    language: string;
    hint: string;
    body?: string;
};
export declare const sendWhatsAppTemplateMessage: import("convex/server").RegisteredAction<"internal", {
    wamid?: string;
    to: string;
    templateName: string;
    language: string;
}, Promise<Record<string, unknown>>>;
export declare const selectWhatsappTemplateWithAI: import("convex/server").RegisteredAction<"internal", {
    userMessage: string;
    conversationSnippet: string;
    templatesJson: string;
}, Promise<{
    name: string;
    language: string;
}>>;
export declare const maybeSendWhatsappTemplateReply: import("convex/server").RegisteredAction<"internal", {
    wamid?: string;
    conversationId: import("convex/values").GenericId<"conversations">;
    phone: string;
    userMessage: string;
}, Promise<{
    sent: boolean;
    templateName?: string;
}>>;
export type CatalogIntent = {
    intent: "none";
} | {
    intent: "single_finca";
    fincaName: string;
} | {
    intent: "more_options";
} | {
    intent: "search_catalog";
    location: string;
    hasWeekend?: boolean;
    dateD1?: number;
    dateD2?: number;
    minCapacity?: number;
    sortByPrice?: boolean;
};
export declare const detectCatalogIntentWithAI: import("convex/server").RegisteredAction<"internal", {
    conversationSnippet?: string;
    userMessage: string;
}, Promise<CatalogIntent>>;
export declare const maybeSendSingleFincaCatalogForUserMessage: import("convex/server").RegisteredAction<"internal", {
    wamid?: string;
    extractedFincaName?: string;
    conversationId: import("convex/values").GenericId<"conversations">;
    phone: string;
    userMessage: string;
}, Promise<{
    sent: boolean;
    fincaTitle?: string;
}>>;
export declare const maybeSendCatalogForUserMessage: import("convex/server").RegisteredAction<"internal", {
    wamid?: string;
    catalogIntent?: {
        intent: "more_options";
    } | {
        minCapacity?: number;
        sortByPrice?: boolean;
        hasWeekend?: boolean;
        dateD1?: number;
        dateD2?: number;
        location: string;
        intent: "search_catalog";
    };
    conversationId: import("convex/values").GenericId<"conversations">;
    phone: string;
    userMessage: string;
}, Promise<{
    sent: boolean;
    location?: string;
    fincasCount?: number;
    fincasFoundButNoCatalog?: boolean;
}>>;
export declare const sendWhatsAppCatalogList: import("convex/server").RegisteredAction<"internal", {
    catalogId?: string;
    wamid?: string;
    bodyText?: string;
    to: string;
    productRetailerIds: string[];
}, Promise<any>>;
export declare const extractContractData: import("convex/server").RegisteredAction<"public", {
    conversationId: import("convex/values").GenericId<"conversations">;
}, Promise<any>>;
export declare const backfillTemplateMessages: import("convex/server").RegisteredAction<"internal", {}, Promise<{
    updated: number;
}>>;
export declare const listAllAssistantMessages: import("convex/server").RegisteredQuery<"internal", {}, Promise<any>>;
