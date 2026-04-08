export declare const getByPropertyId: import("convex/server").RegisteredQuery<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    _id: import("convex/values").GenericId<"propertyOwnerInfo">;
    _creationTime: number;
    bankCertificationUrl?: string;
    idCopyUrl?: string;
    rntPdfUrl?: string;
    chamberOfCommerceUrl?: string;
    propertyId: import("convex/values").GenericId<"properties">;
    ownerUserId: string;
    rutNumber: string;
    bankName: string;
    accountNumber: string;
    rntNumber: string;
    createdAt: number;
    updatedAt: number;
}>>;
export declare const getOwnedProperties: import("convex/server").RegisteredQuery<"public", {
    ownerUserId: string;
}, Promise<any[]>>;
export declare const upsert: import("convex/server").RegisteredMutation<"public", {
    bankCertificationUrl?: string;
    idCopyUrl?: string;
    rntPdfUrl?: string;
    chamberOfCommerceUrl?: string;
    propertyId: import("convex/values").GenericId<"properties">;
    ownerUserId: string;
    rutNumber: string;
    bankName: string;
    accountNumber: string;
    rntNumber: string;
}, Promise<import("convex/values").GenericId<"propertyOwnerInfo">>>;
