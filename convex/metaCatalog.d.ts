export declare const syncCatalogsFromMeta: import("convex/server").RegisteredAction<"public", {
    catalogIds?: string[];
}, Promise<{
    message: string;
    catalogs: {
        id: string;
        name: string;
    }[];
}>>;
export declare const testMetaCatalogToken: import("convex/server").RegisteredAction<"public", {
    catalogId: string;
}, Promise<Record<string, unknown>>>;
export declare const syncPropertyToCatalogs: import("convex/server").RegisteredAction<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    synced: number;
}>>;
export declare const syncProductToMetaCatalog: import("convex/server").RegisteredAction<"internal", {
    propertyId: import("convex/values").GenericId<"properties">;
    whatsappCatalogId: string;
    method: "CREATE" | "UPDATE";
}, Promise<void>>;
export declare const syncPropertyToAllCatalogs: import("convex/server").RegisteredAction<"internal", {
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<void>>;
export declare const deleteFromMetaCatalogs: import("convex/server").RegisteredAction<"internal", {
    items: {
        whatsappCatalogId: string;
        retailer_id: string;
    }[];
}, Promise<void>>;
