export declare const get: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    connected: boolean;
    calendarId: string;
    hasTokens: boolean;
    connectedEmail: string;
    connectedName: string;
}>>;
export declare const getForSync: import("convex/server").RegisteredQuery<"internal", {}, Promise<{
    _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
    _creationTime: number;
    calendarId?: string;
    connectedEmail?: string;
    connectedName?: string;
    expiresAt?: number;
    accessToken?: string;
    refreshToken?: string;
    connected: boolean;
    createdAt: number;
    updatedAt: number;
}>>;
export declare const saveTokens: import("convex/server").RegisteredMutation<"public", {
    calendarId?: string;
    connectedEmail?: string;
    connectedName?: string;
    expiresAt?: number;
    refreshToken?: string;
    accessToken: string;
}, Promise<import("convex/values").GenericId<"googleCalendarIntegrations">>>;
export declare const disconnect: import("convex/server").RegisteredMutation<"public", {}, Promise<import("convex/values").GenericId<"googleCalendarIntegrations">>>;
export declare const generateAuthUrl: import("convex/server").RegisteredAction<"public", {
    redirectUri: string;
}, Promise<string>>;
export declare const exchangeCodeForTokens: import("convex/server").RegisteredAction<"public", {
    redirectUri: string;
    code: string;
}, Promise<{
    ok: boolean;
    email: string;
}>>;
export declare const syncBookingToCalendar: import("convex/server").RegisteredAction<"internal", {
    bookingId: import("convex/values").GenericId<"bookings">;
}, Promise<void>>;
export declare const deleteBookingFromCalendar: import("convex/server").RegisteredAction<"internal", {
    googleCalendarId?: string;
    googleEventId: string;
}, Promise<void>>;
