export declare const list: import("convex/server").RegisteredQuery<"public", {
    limit?: number;
    propertyId: string;
}, Promise<{
    user: {
        name: any;
        image: any;
    };
    _id: import("convex/values").GenericId<"reviews">;
    _creationTime: number;
    userId?: string;
    bookingId?: import("convex/values").GenericId<"bookings">;
    comment?: string;
    verified?: boolean;
    propertyId: import("convex/values").GenericId<"properties">;
    rating: number;
    createdAt: number;
    updatedAt: number;
}[]>>;
export declare const getByIdDebug: import("convex/server").RegisteredMutation<"public", {
    id: string;
}, Promise<any>>;
export declare const debugUsers: import("convex/server").RegisteredQuery<"public", {}, Promise<any>>;
export declare const getById: import("convex/server").RegisteredQuery<"public", {
    id: import("convex/values").GenericId<"reviews">;
}, Promise<{
    _id: import("convex/values").GenericId<"reviews">;
    _creationTime: number;
    userId?: string;
    bookingId?: import("convex/values").GenericId<"bookings">;
    comment?: string;
    verified?: boolean;
    propertyId: import("convex/values").GenericId<"properties">;
    rating: number;
    createdAt: number;
    updatedAt: number;
}>>;
export declare const create: import("convex/server").RegisteredMutation<"public", {
    userId?: string;
    bookingId?: import("convex/values").GenericId<"bookings">;
    comment?: string;
    verified?: boolean;
    propertyId: string;
    rating: number;
}, Promise<import("convex/values").GenericId<"reviews">>>;
export declare const update: import("convex/server").RegisteredMutation<"public", {
    rating?: number;
    comment?: string;
    id: import("convex/values").GenericId<"reviews">;
}, Promise<import("convex/values").GenericId<"reviews">>>;
export declare const remove: import("convex/server").RegisteredMutation<"public", {
    id: import("convex/values").GenericId<"reviews">;
}, Promise<{
    success: boolean;
}>>;
export declare const getByIdHardcoded: import("convex/server").RegisteredMutation<"public", {}, Promise<any>>;
