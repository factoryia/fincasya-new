"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getByIdHardcoded = exports.remove = exports.update = exports.create = exports.getById = exports.debugUsers = exports.getByIdDebug = exports.list = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const auth_1 = require("./betterAuth/auth");
exports.list = (0, server_1.query)({
    args: {
        propertyId: values_1.v.string(),
        limit: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 50;
        let normalizedId = ctx.db.normalizeId('properties', args.propertyId);
        if (!normalizedId) {
            const property = await ctx.db
                .query('properties')
                .withIndex('by_code', (q) => q.eq('code', args.propertyId))
                .first();
            if (!property)
                return [];
            normalizedId = property._id;
        }
        const reviews = await ctx.db
            .query('reviews')
            .withIndex('by_property', (q) => q.eq('propertyId', normalizedId))
            .order('desc')
            .take(limit);
        const reviewsWithUser = await Promise.all(reviews.map(async (review) => {
            const user = review.userId
                ? await ctx.db.get(review.userId)
                : null;
            const userData = user;
            return {
                ...review,
                user: userData
                    ? {
                        name: userData.name || 'Usuario',
                        image: userData.image,
                    }
                    : {
                        name: 'Usuario',
                        image: `https://api.dicebear.com/7.x/notionists/svg?seed=${review.userId || review._id}`,
                    },
            };
        }));
        return reviewsWithUser;
    },
});
exports.getByIdDebug = (0, server_1.mutation)({
    args: { id: values_1.v.string() },
    handler: async (ctx, args) => {
        const results = {};
        try {
            const userId = ctx.db.normalizeId('user', args.id);
            results.user = userId ? await ctx.db.get(userId) : 'not a user id';
        }
        catch (e) {
            results.user_error = e.message;
        }
        try {
            const dcId = ctx.db.normalizeId('discountCodes', args.id);
            results.discountCodes = dcId
                ? await ctx.db.get(dcId)
                : 'not a discountCodes id';
        }
        catch (e) {
            results.discountCodes_error = e.message;
        }
        try {
            const usersId = ctx.db.normalizeId('users', args.id);
            results.users_plural = usersId
                ? await ctx.db.get(usersId)
                : 'not a users id';
        }
        catch (e) {
            results.users_plural_error = e.message;
        }
        try {
            results.userByUserIdField = await ctx.db
                .query('user')
                .withIndex('userId', (q) => q.eq('userId', args.id))
                .first();
        }
        catch (e) {
            results.userByUserIdField_error = e.message;
        }
        return results;
    },
});
exports.debugUsers = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        console.log('--- START DEBUG USERS ---');
        const data = {};
        try {
            const users = await ctx.db.query('user').collect();
            data.user_count = users.length;
            data.user_sample = users.slice(0, 3).map((u) => ({
                _id: u._id,
                name: u.name,
                userId: u.userId,
                email: u.email,
            }));
            console.log(`User count: ${users.length}`);
            const me = await ctx.db
                .query('user')
                .withIndex('email_name', (q) => q.eq('email', 'santiago.suescun@gmail.com'))
                .first();
            data.found_me_by_email = !!me;
            data.authComponent_keys = Object.keys(auth_1.authComponent);
        }
        catch (e) {
            data.user_error = e.message;
            console.error(`User error: ${e.message}`);
        }
        try {
            const usersPlural = await ctx.db.query('users').collect();
            data.users_plural_count = usersPlural.length;
            data.users_plural_sample = usersPlural
                .slice(0, 3)
                .map((u) => ({ _id: u._id, name: u.name, userId: u.userId }));
            console.log(`Users (plural) count: ${usersPlural.length}`);
        }
        catch (e) {
            data.users_plural_error = e.message;
            console.error(`Users (plural) error: ${e.message}`);
        }
        try {
            const sessions = await ctx.db.query('session').collect();
            data.sessions_count = sessions.length;
            data.sessions_sample = sessions.slice(0, 3);
            console.log(`Session count: ${sessions.length}`);
        }
        catch (e) {
            data.sessions_error = e.message;
            console.error(`Session error: ${e.message}`);
        }
        try {
            const props = await ctx.db.query('properties').collect();
            data.properties_count = props.length;
            console.log(`Properties count: ${props.length}`);
        }
        catch (e) {
            data.properties_error = e.message;
        }
        try {
            const revs = await ctx.db.query('reviews').order('desc').take(10);
            data.reviews_count = revs.length;
            data.reviews_sample = revs.map((r) => ({
                _id: r._id,
                userId: r.userId,
                propertyId: r.propertyId,
            }));
            console.log(`Reviews count: ${revs.length}`);
        }
        catch (e) {
            data.reviews_error = e.message;
            console.error(`Reviews error: ${e.message}`);
        }
        try {
            const dcs = await ctx.db.query('discountCodes').collect();
            data.discountCodes_count = dcs.length;
            data.discountCodes_sample = dcs
                .slice(0, 3)
                .map((d) => ({ _id: d._id, code: d.code }));
            console.log(`DiscountCodes count: ${dcs.length}`);
        }
        catch (e) {
            data.discountCodes_error = e.message;
            console.error(`DiscountCodes error: ${e.message}`);
        }
        console.log('--- END DEBUG USERS ---');
        return data;
    },
});
exports.getById = (0, server_1.query)({
    args: { id: values_1.v.id('reviews') },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
exports.create = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.string(),
        bookingId: values_1.v.optional(values_1.v.id('bookings')),
        userId: values_1.v.optional(values_1.v.string()),
        rating: values_1.v.number(),
        comment: values_1.v.optional(values_1.v.string()),
        verified: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        const { propertyId, userId, ...rest } = args;
        let normalizedPropertyId = ctx.db.normalizeId('properties', propertyId);
        if (!normalizedPropertyId) {
            const property = await ctx.db
                .query('properties')
                .withIndex('by_code', (q) => q.eq('code', propertyId))
                .first();
            if (!property)
                throw new Error('ID o código de propiedad inválido');
            normalizedPropertyId = property._id;
        }
        let userDocId = undefined;
        if (userId) {
            console.log(`Resolving user: ${userId}`);
            const normalizedUserId = ctx.db.normalizeId('user', userId);
            if (normalizedUserId) {
                userDocId = normalizedUserId;
                console.log(`Normalized to: ${userDocId}`);
            }
            else {
                const user = await ctx.db
                    .query('user')
                    .withIndex('userId', (q) => q.eq('userId', userId))
                    .first();
                if (user) {
                    userDocId = user._id;
                    console.log(`Found via index: ${userDocId}`);
                }
                else {
                    console.log(`User not found via index for: ${userId}, using raw ID`);
                    userDocId = userId;
                }
            }
        }
        const now = Date.now();
        console.log(`Inserting review with userId: ${userDocId}`);
        const reviewId = await ctx.db.insert('reviews', {
            ...rest,
            propertyId: normalizedPropertyId,
            userId: userDocId,
            createdAt: now,
            updatedAt: now,
        });
        await updatePropertyStats(ctx, normalizedPropertyId);
        return reviewId;
    },
});
exports.update = (0, server_1.mutation)({
    args: {
        id: values_1.v.id('reviews'),
        rating: values_1.v.optional(values_1.v.number()),
        comment: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        const existing = await ctx.db.get(id);
        if (!existing)
            throw new Error('Reseña no encontrada');
        await ctx.db.patch(id, {
            ...updates,
            updatedAt: Date.now(),
        });
        if (updates.rating !== undefined && updates.rating !== existing.rating) {
            await updatePropertyStats(ctx, existing.propertyId);
        }
        return id;
    },
});
exports.remove = (0, server_1.mutation)({
    args: { id: values_1.v.id('reviews') },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.id);
        if (!existing)
            throw new Error('Reseña no encontrada');
        await ctx.db.delete(args.id);
        await updatePropertyStats(ctx, existing.propertyId);
        return { success: true };
    },
});
async function updatePropertyStats(ctx, propertyId) {
    const allReviews = await ctx.db
        .query('reviews')
        .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
        .collect();
    const reviewsCount = allReviews.length;
    let rating = 0;
    if (reviewsCount > 0) {
        const sum = allReviews.reduce((acc, r) => acc + r.rating, 0);
        rating = Number((sum / reviewsCount).toFixed(1));
    }
    await ctx.db.patch(propertyId, {
        rating,
        reviewsCount,
    });
}
exports.getByIdHardcoded = (0, server_1.mutation)({
    args: {},
    handler: async (ctx) => {
        const id = 'jd7ars35k6jgtt7h7rmrgpn62182jwph';
        const results = {};
        try {
            const userId = ctx.db.normalizeId('user', id);
            results.user = userId ? await ctx.db.get(userId) : 'not a user id';
        }
        catch (e) {
            results.user_error = e.message;
        }
        try {
            const usersId = ctx.db.normalizeId('users', id);
            results.users_plural = usersId
                ? await ctx.db.get(usersId)
                : 'not a users id';
        }
        catch (e) {
            results.users_plural_error = e.message;
        }
        try {
            const dcId = ctx.db.normalizeId('discountCodes', id);
            results.discountCodes = dcId
                ? await ctx.db.get(dcId)
                : 'not a discountCodes id';
        }
        catch (e) {
            results.discountCodes_error = e.message;
        }
        return results;
    },
});
//# sourceMappingURL=reviews.js.map