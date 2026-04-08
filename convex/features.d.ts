export declare const listIcons: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"iconography">;
    _creationTime: number;
    name?: string;
    iconUrl?: string;
    emoji?: string;
    createdAt: number;
    updatedAt: number;
}[]>>;
export declare const getIconById: import("convex/server").RegisteredQuery<"public", {
    id: import("convex/values").GenericId<"iconography">;
}, Promise<{
    _id: import("convex/values").GenericId<"iconography">;
    _creationTime: number;
    name?: string;
    iconUrl?: string;
    emoji?: string;
    createdAt: number;
    updatedAt: number;
}>>;
export declare const createIcon: import("convex/server").RegisteredMutation<"public", {
    name?: string;
    iconUrl?: string;
    emoji?: string;
}, Promise<import("convex/values").GenericId<"iconography">>>;
export declare const bulkCreateIcons: import("convex/server").RegisteredMutation<"public", {
    icons: {
        name?: string;
        iconUrl?: string;
        emoji?: string;
    }[];
}, Promise<string[]>>;
export declare const updateIcon: import("convex/server").RegisteredMutation<"public", {
    name?: string;
    iconUrl?: string;
    emoji?: string;
    id: import("convex/values").GenericId<"iconography">;
}, Promise<import("convex/values").GenericId<"iconography">>>;
export declare const removeIcon: import("convex/server").RegisteredMutation<"public", {
    id: import("convex/values").GenericId<"iconography">;
}, Promise<{
    success: boolean;
}>>;
