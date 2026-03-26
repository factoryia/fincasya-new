import * as XLSX from "xlsx";

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

export function sanitizeTemplateName(raw: string): string {
  const s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (s || "template").slice(0, 512);
}

function normalizeKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

export function rowsToKeyValue(rows: unknown[][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row || row.length < 1) continue;
    const key = normalizeKey(cellToString(row[0]));
    if (!key || key.startsWith("_")) continue;
    const val = row.length >= 2 ? cellToString(row[1]) : "";
    out[key] = val;
  }
  return out;
}

export function shouldSkipSheet(name: string): boolean {
  const n = name.trim();
  const lower = n.toLowerCase();
  return (
    n.startsWith("_") ||
    lower === "readme" ||
    lower === "instrucciones" ||
    lower === "ayuda"
  );
}

function alias(kv: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = kv[k];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

const CATEGORIES = new Set(["UTILITY", "MARKETING", "AUTHENTICATION"]);

export function buildPayloadFromKeyValue(
  kv: Record<string, string>,
  fallbackName: string,
  defaultWabaId?: string
): Record<string, unknown> {
  const name = sanitizeTemplateName(
    alias(kv, "name", "nombre", "template_name") || fallbackName
  );
  const language = (
    alias(kv, "language", "idioma", "lang") || "es"
  ).toLowerCase();
  let category = (
    alias(kv, "category", "categoria", "cat") || "UTILITY"
  ).toUpperCase();
  if (!CATEGORIES.has(category)) category = "UTILITY";
  const wabaId = (
    alias(kv, "waba_id", "wabaid", "waba") ||
    defaultWabaId ||
    ""
  ).trim();
  if (!wabaId) {
    throw new Error(
      "Falta waba_id en la hoja o la variable YCLOUD_WABA_ID en Convex"
    );
  }
  const body = alias(kv, "body", "texto", "cuerpo", "mensaje");
  if (!body) {
    throw new Error('Falta el cuerpo (clave body o texto) en columnas A/B');
  }
  const components: Array<Record<string, unknown>> = [];
  const header = alias(kv, "header", "encabezado", "cabecera");
  if (header) {
    components.push({ type: "HEADER", format: "TEXT", text: header });
  }
  components.push({ type: "BODY", text: body });
  const footer = alias(kv, "footer", "pie", "pie_de_pagina");
  if (footer) {
    components.push({ type: "FOOTER", text: footer });
  }
  return {
    wabaId,
    name,
    language,
    category,
    components,
  };
}

export type ParsedSheetOk = {
  sheet: string;
  ok: true;
  payload: Record<string, unknown>;
};
export type ParsedSheetErr = { sheet: string; ok: false; error: string };
export type ParsedSheet = ParsedSheetOk | ParsedSheetErr;

export function parseWorkbookSheetsToPayloads(
  buffer: ArrayBuffer,
  defaultWabaId?: string
): ParsedSheet[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const results: ParsedSheet[] = [];

  for (const sheetName of wb.SheetNames) {
    if (shouldSkipSheet(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    const kv = rowsToKeyValue(rows);
    const fallback = sanitizeTemplateName(sheetName);
    try {
      const payload = buildPayloadFromKeyValue(kv, fallback, defaultWabaId);
      results.push({ sheet: sheetName, ok: true, payload });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ sheet: sheetName, ok: false, error: msg });
    }
  }
  return results;
}
