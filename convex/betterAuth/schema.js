"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tables = void 0;
const server_1 = require("convex/server");
const values_1 = require("convex/values");
exports.tables = {
    user: (0, server_1.defineTable)({
        name: values_1.v.string(),
        email: values_1.v.string(),
        emailVerified: values_1.v.boolean(),
        image: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
        userId: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        role: values_1.v.optional(values_1.v.union(values_1.v.literal('admin'), values_1.v.literal('assistant'), values_1.v.literal('vendedor'), values_1.v.literal('propietario'), values_1.v.literal('user'), values_1.v.null())),
        banned: values_1.v.optional(values_1.v.boolean()),
        phone: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        position: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        documentId: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
    })
        .index('email_name', ['email', 'name'])
        .index('name', ['name'])
        .index('userId', ['userId']),
    session: (0, server_1.defineTable)({
        expiresAt: values_1.v.number(),
        token: values_1.v.string(),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
        ipAddress: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        userAgent: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        userId: values_1.v.string(),
    })
        .index('expiresAt', ['expiresAt'])
        .index('expiresAt_userId', ['expiresAt', 'userId'])
        .index('token', ['token'])
        .index('userId', ['userId']),
    account: (0, server_1.defineTable)({
        accountId: values_1.v.string(),
        providerId: values_1.v.string(),
        userId: values_1.v.string(),
        accessToken: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        refreshToken: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        idToken: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        accessTokenExpiresAt: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.number())),
        refreshTokenExpiresAt: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.number())),
        scope: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        password: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('accountId', ['accountId'])
        .index('accountId_providerId', ['accountId', 'providerId'])
        .index('providerId_userId', ['providerId', 'userId'])
        .index('userId', ['userId']),
    verification: (0, server_1.defineTable)({
        identifier: values_1.v.string(),
        value: values_1.v.string(),
        expiresAt: values_1.v.number(),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('expiresAt', ['expiresAt'])
        .index('identifier', ['identifier']),
    jwks: (0, server_1.defineTable)({
        publicKey: values_1.v.string(),
        privateKey: values_1.v.string(),
        createdAt: values_1.v.number(),
        expiresAt: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.number())),
    }),
};
const schema = (0, server_1.defineSchema)(exports.tables);
exports.default = schema;
//# sourceMappingURL=schema.js.map