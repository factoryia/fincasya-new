export declare const list: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"globalPricing">;
    _creationTime: number;
    fechaDesde?: string;
    fechaHasta?: string;
    fechas?: string[];
    activa?: boolean;
    nombre: string;
    createdAt: number;
    updatedAt: number;
}[]>>;
export declare const getById: import("convex/server").RegisteredQuery<"public", {
    id: import("convex/values").GenericId<"globalPricing">;
}, Promise<{
    _id: import("convex/values").GenericId<"globalPricing">;
    _creationTime: number;
    fechaDesde?: string;
    fechaHasta?: string;
    fechas?: string[];
    activa?: boolean;
    nombre: string;
    createdAt: number;
    updatedAt: number;
}>>;
export declare const create: import("convex/server").RegisteredMutation<"public", {
    fechaDesde?: string;
    fechaHasta?: string;
    fechas?: string[];
    activa?: boolean;
    nombre: string;
}, Promise<import("convex/values").GenericId<"globalPricing">>>;
export declare const update: import("convex/server").RegisteredMutation<"public", {
    nombre?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    fechas?: string[];
    activa?: boolean;
    id: import("convex/values").GenericId<"globalPricing">;
}, Promise<void>>;
export declare const remove: import("convex/server").RegisteredMutation<"public", {
    id: import("convex/values").GenericId<"globalPricing">;
}, Promise<{
    success: boolean;
}>>;
