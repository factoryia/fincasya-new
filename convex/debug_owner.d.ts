export declare const getFirstOwner: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"user">;
    _creationTime: number;
    role?: "user" | "admin" | "assistant" | "vendedor" | "propietario";
    image?: string;
    phone?: string;
    userId?: string;
    position?: string;
    documentId?: string;
    banned?: boolean;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: number;
    updatedAt: number;
}>>;
