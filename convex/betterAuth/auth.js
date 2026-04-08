"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuth = exports.options = exports.createAuthOptions = exports.authComponent = void 0;
const better_auth_1 = require("@convex-dev/better-auth");
const plugins_1 = require("@convex-dev/better-auth/plugins");
const plugins_2 = require("better-auth/plugins");
const better_auth_2 = require("better-auth");
const api_1 = require("../_generated/api");
const auth_config_1 = __importDefault(require("../auth.config"));
const schema_1 = __importDefault(require("./schema"));
exports.authComponent = (0, better_auth_1.createClient)(api_1.components.betterAuth, {
    local: { schema: schema_1.default },
    verbose: false,
});
const createAuthOptions = (ctx) => {
    const hasValidCtx = ctx && typeof ctx === 'object' && 'db' in ctx;
    const database = exports.authComponent.adapter(ctx);
    let siteUrl = process.env.SITE_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        'http://localhost:3000';
    if (siteUrl.includes('localhost:3001')) {
        siteUrl = 'http://localhost:3000';
    }
    return {
        appName: 'Fincas Ya',
        baseURL: siteUrl + '/api/auth',
        basePath: '/api/auth',
        secret: process.env.BETTER_AUTH_SECRET,
        database,
        trustedOrigins: [
            'http://localhost:3000',
            'http://localhost:3001',
            'https://adventurous-octopus-651.convex.site',
            'https://fincasya.com',
            'https://www.fincasya.com',
            'https://*.ngrok-free.dev',
        ],
        emailAndPassword: {
            enabled: true,
        },
        user: {
            additionalFields: {
                role: {
                    type: 'string',
                    required: false,
                    defaultValue: 'user',
                    input: true,
                },
            },
        },
        session: {
            expiresIn: 60 * 60 * 24 * 7,
            updateAge: 60 * 60 * 24,
        },
        plugins: [
            (0, plugins_1.convex)({
                authConfig: auth_config_1.default,
                options: {
                    basePath: '/api/auth',
                },
                jwt: {
                    expirationSeconds: 60 * 60 * 24,
                },
            }),
            (0, plugins_2.admin)(),
        ],
    };
};
exports.createAuthOptions = createAuthOptions;
exports.options = (0, exports.createAuthOptions)({});
const createAuth = (ctx) => {
    return (0, better_auth_2.betterAuth)((0, exports.createAuthOptions)(ctx));
};
exports.createAuth = createAuth;
//# sourceMappingURL=auth.js.map