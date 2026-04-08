export declare const tables: {
    user: import("convex/server").TableDefinition<import("convex/values").VObject<{
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
    }, {
        name: import("convex/values").VString<string, "required">;
        email: import("convex/values").VString<string, "required">;
        emailVerified: import("convex/values").VBoolean<boolean, "required">;
        image: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
        userId: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        role: import("convex/values").VUnion<"user" | "admin" | "assistant" | "vendedor" | "propietario", [import("convex/values").VLiteral<"admin", "required">, import("convex/values").VLiteral<"assistant", "required">, import("convex/values").VLiteral<"vendedor", "required">, import("convex/values").VLiteral<"propietario", "required">, import("convex/values").VLiteral<"user", "required">, import("convex/values").VNull<null, "required">], "optional", never>;
        banned: import("convex/values").VBoolean<boolean, "optional">;
        phone: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        position: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        documentId: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
    }, "required", "email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned">, {
        email_name: ["email", "name", "_creationTime"];
        name: ["name", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    session: import("convex/server").TableDefinition<import("convex/values").VObject<{
        ipAddress?: string;
        userAgent?: string;
        token: string;
        userId: string;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
    }, {
        expiresAt: import("convex/values").VFloat64<number, "required">;
        token: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
        ipAddress: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        userAgent: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        userId: import("convex/values").VString<string, "required">;
    }, "required", "token" | "userId" | "createdAt" | "updatedAt" | "expiresAt" | "ipAddress" | "userAgent">, {
        expiresAt: ["expiresAt", "_creationTime"];
        expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
        token: ["token", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    account: import("convex/server").TableDefinition<import("convex/values").VObject<{
        password?: string;
        accessToken?: string;
        refreshToken?: string;
        idToken?: string;
        accessTokenExpiresAt?: number;
        refreshTokenExpiresAt?: number;
        scope?: string;
        accountId: string;
        userId: string;
        createdAt: number;
        updatedAt: number;
        providerId: string;
    }, {
        accountId: import("convex/values").VString<string, "required">;
        providerId: import("convex/values").VString<string, "required">;
        userId: import("convex/values").VString<string, "required">;
        accessToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        refreshToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        idToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        accessTokenExpiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
        refreshTokenExpiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
        scope: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        password: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope">, {
        accountId: ["accountId", "_creationTime"];
        accountId_providerId: ["accountId", "providerId", "_creationTime"];
        providerId_userId: ["providerId", "userId", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    verification: import("convex/server").TableDefinition<import("convex/values").VObject<{
        value: string;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
        identifier: string;
    }, {
        identifier: import("convex/values").VString<string, "required">;
        value: import("convex/values").VString<string, "required">;
        expiresAt: import("convex/values").VFloat64<number, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "value" | "createdAt" | "updatedAt" | "expiresAt" | "identifier">, {
        expiresAt: ["expiresAt", "_creationTime"];
        identifier: ["identifier", "_creationTime"];
    }, {}, {}>;
    jwks: import("convex/server").TableDefinition<import("convex/values").VObject<{
        expiresAt?: number;
        createdAt: number;
        publicKey: string;
        privateKey: string;
    }, {
        publicKey: import("convex/values").VString<string, "required">;
        privateKey: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        expiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
    }, "required", "createdAt" | "expiresAt" | "publicKey" | "privateKey">, {}, {}, {}>;
};
declare const schema: import("convex/server").SchemaDefinition<{
    user: import("convex/server").TableDefinition<import("convex/values").VObject<{
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
    }, {
        name: import("convex/values").VString<string, "required">;
        email: import("convex/values").VString<string, "required">;
        emailVerified: import("convex/values").VBoolean<boolean, "required">;
        image: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
        userId: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        role: import("convex/values").VUnion<"user" | "admin" | "assistant" | "vendedor" | "propietario", [import("convex/values").VLiteral<"admin", "required">, import("convex/values").VLiteral<"assistant", "required">, import("convex/values").VLiteral<"vendedor", "required">, import("convex/values").VLiteral<"propietario", "required">, import("convex/values").VLiteral<"user", "required">, import("convex/values").VNull<null, "required">], "optional", never>;
        banned: import("convex/values").VBoolean<boolean, "optional">;
        phone: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        position: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        documentId: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
    }, "required", "email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned">, {
        email_name: ["email", "name", "_creationTime"];
        name: ["name", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    session: import("convex/server").TableDefinition<import("convex/values").VObject<{
        ipAddress?: string;
        userAgent?: string;
        token: string;
        userId: string;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
    }, {
        expiresAt: import("convex/values").VFloat64<number, "required">;
        token: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
        ipAddress: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        userAgent: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        userId: import("convex/values").VString<string, "required">;
    }, "required", "token" | "userId" | "createdAt" | "updatedAt" | "expiresAt" | "ipAddress" | "userAgent">, {
        expiresAt: ["expiresAt", "_creationTime"];
        expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
        token: ["token", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    account: import("convex/server").TableDefinition<import("convex/values").VObject<{
        password?: string;
        accessToken?: string;
        refreshToken?: string;
        idToken?: string;
        accessTokenExpiresAt?: number;
        refreshTokenExpiresAt?: number;
        scope?: string;
        accountId: string;
        userId: string;
        createdAt: number;
        updatedAt: number;
        providerId: string;
    }, {
        accountId: import("convex/values").VString<string, "required">;
        providerId: import("convex/values").VString<string, "required">;
        userId: import("convex/values").VString<string, "required">;
        accessToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        refreshToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        idToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        accessTokenExpiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
        refreshTokenExpiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
        scope: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        password: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope">, {
        accountId: ["accountId", "_creationTime"];
        accountId_providerId: ["accountId", "providerId", "_creationTime"];
        providerId_userId: ["providerId", "userId", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    verification: import("convex/server").TableDefinition<import("convex/values").VObject<{
        value: string;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
        identifier: string;
    }, {
        identifier: import("convex/values").VString<string, "required">;
        value: import("convex/values").VString<string, "required">;
        expiresAt: import("convex/values").VFloat64<number, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "value" | "createdAt" | "updatedAt" | "expiresAt" | "identifier">, {
        expiresAt: ["expiresAt", "_creationTime"];
        identifier: ["identifier", "_creationTime"];
    }, {}, {}>;
    jwks: import("convex/server").TableDefinition<import("convex/values").VObject<{
        expiresAt?: number;
        createdAt: number;
        publicKey: string;
        privateKey: string;
    }, {
        publicKey: import("convex/values").VString<string, "required">;
        privateKey: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        expiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
    }, "required", "createdAt" | "expiresAt" | "publicKey" | "privateKey">, {}, {}, {}>;
}, true>;
export default schema;
