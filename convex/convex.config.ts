import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config";
import betterAuth from "./betterAuth/convex.config";

const app = defineApp();
app.use(rag);
app.use(betterAuth);

export default app;
