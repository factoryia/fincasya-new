import type { Id } from "./_generated/dataModel";
export declare const listByProperty: import("convex/server").RegisteredQuery<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    catalogName: string;
    whatsappCatalogId: string;
    _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
    _creationTime: number;
    propertyId: import("convex/values").GenericId<"properties">;
    createdAt: number;
    updatedAt: number;
    catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
    productRetailerId: string;
}[]>>;
export declare const listByCatalog: import("convex/server").RegisteredQuery<"public", {
    catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
}, Promise<{
    _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
    _creationTime: number;
    propertyId: import("convex/values").GenericId<"properties">;
    createdAt: number;
    updatedAt: number;
    catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
    productRetailerId: string;
}[]>>;
export declare const getProductRetailerIdsForProperties: import("convex/server").RegisteredQuery<"public", {
    propertyIds: import("convex/values").GenericId<"properties">[];
    catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
}, Promise<{
    propertyId: Id<"properties">;
    productRetailerId: string;
}[]>>;
export declare const getPropertyIdsInAnyCatalog: import("convex/server").RegisteredQuery<"public", {}, Promise<import("convex/values").GenericId<"properties">[]>>;
export declare const setPropertyInCatalog: import("convex/server").RegisteredMutation<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
    catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
    productRetailerId: string;
}, Promise<import("convex/values").GenericId<"propertyWhatsAppCatalog">>>;
export declare const removePropertyFromCatalog: import("convex/server").RegisteredMutation<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
    catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
}, Promise<import("convex/values").GenericId<"properties">>>;
export declare const setPropertyCatalogs: import("convex/server").RegisteredMutation<"public", {
    entries: {
        catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
        productRetailerId: string;
    }[];
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<import("convex/values").GenericId<"properties">>>;
