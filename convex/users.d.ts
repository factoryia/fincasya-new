export declare const resetPassword: import("convex/server").RegisteredAction<"public", {
    userId: string;
    newPassword: string;
}, Promise<{
    success: boolean;
}>>;
export declare const list: import("convex/server").RegisteredQuery<"public", {
    limit?: number;
    cursor?: string;
}, Promise<any>>;
export declare const getById: import("convex/server").RegisteredQuery<"public", {
    id: string;
}, Promise<any>>;
export declare const update: import("convex/server").RegisteredMutation<"public", {
    name?: string;
    role?: "user" | "admin" | "assistant" | "vendedor" | "propietario";
    phone?: string;
    position?: string;
    documentId?: string;
    banned?: boolean;
    id: string;
}, Promise<string>>;
export declare const updateByEmail: import("convex/server").RegisteredMutation<"public", {
    name?: string;
    role?: "user" | "admin" | "assistant" | "vendedor" | "propietario";
    phone?: string;
    position?: string;
    documentId?: string;
    banned?: boolean;
    email: string;
}, Promise<any>>;
export declare const updatePassword: import("convex/server").RegisteredMutation<"public", {
    userId: string;
    newPasswordHash: string;
}, Promise<{
    success: boolean;
    message: string;
} | {
    success: boolean;
    message?: undefined;
}>>;
export declare const remove: import("convex/server").RegisteredMutation<"public", {
    id: string;
}, Promise<{
    success: boolean;
}>>;
export declare const listPropietarios: import("convex/server").RegisteredQuery<"public", {}, Promise<any>>;
