import type { Id } from "./_generated/dataModel";
export declare const list: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"whatsappCatalogs">;
    _creationTime: number;
    order?: number;
    isDefault?: boolean;
    locationKeyword?: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    whatsappCatalogId: string;
}[]>>;
export declare const getById: import("convex/server").RegisteredQuery<"public", {
    id: import("convex/values").GenericId<"whatsappCatalogs">;
}, Promise<{
    _id: import("convex/values").GenericId<"whatsappCatalogs">;
    _creationTime: number;
    order?: number;
    isDefault?: boolean;
    locationKeyword?: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    whatsappCatalogId: string;
}>>;
export declare const getDefault: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"whatsappCatalogs">;
    _creationTime: number;
    order?: number;
    isDefault?: boolean;
    locationKeyword?: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    whatsappCatalogId: string;
}>>;
export declare const getByLocationKeyword: import("convex/server").RegisteredQuery<"public", {
    location: string;
}, Promise<{
    _id: import("convex/values").GenericId<"whatsappCatalogs">;
    _creationTime: number;
    order?: number;
    isDefault?: boolean;
    locationKeyword?: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    whatsappCatalogId: string;
}>>;
export declare const create: import("convex/server").RegisteredMutation<"public", {
    order?: number;
    isDefault?: boolean;
    locationKeyword?: string;
    name: string;
    whatsappCatalogId: string;
}, Promise<import("convex/values").GenericId<"whatsappCatalogs">>>;
export declare const update: import("convex/server").RegisteredMutation<"public", {
    name?: string;
    order?: number;
    whatsappCatalogId?: string;
    isDefault?: boolean;
    locationKeyword?: string;
    id: import("convex/values").GenericId<"whatsappCatalogs">;
}, Promise<import("convex/values").GenericId<"whatsappCatalogs">>>;
export declare const remove: import("convex/server").RegisteredMutation<"public", {
    id: import("convex/values").GenericId<"whatsappCatalogs">;
}, Promise<import("convex/values").GenericId<"whatsappCatalogs">>>;
export declare const syncFromMeta: import("convex/server").RegisteredMutation<"internal", {
    catalogs: {
        name: string;
        id: string;
    }[];
}, Promise<number>>;
export declare const seedCatalogProductos: import("convex/server").RegisteredMutation<"public", {}, Promise<{
    catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
    catalogName: string;
    propertyId: Id<"properties">;
    productRetailerId: string;
}>>;
