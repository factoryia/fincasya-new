import { v } from "convex/values";

/** Valores permitidos; añadir literales aquí + en schema + UI para extender. */
export const operationalStateValidator = v.union(
  v.literal("requires_advisor"),
  v.literal("validate_availability"),
  v.literal("ready_to_book"),
  v.literal("pending_payment"),
  v.literal("pending_data"),
);

export type OperationalState =
  | "requires_advisor"
  | "validate_availability"
  | "ready_to_book"
  | "pending_payment"
  | "pending_data";

export const DEFAULT_OPERATIONAL_STATE: OperationalState = "pending_data";
