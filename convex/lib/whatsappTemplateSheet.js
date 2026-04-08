"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeTemplateName = sanitizeTemplateName;
exports.rowsToKeyValue = rowsToKeyValue;
exports.shouldSkipSheet = shouldSkipSheet;
exports.buildPayloadFromKeyValue = buildPayloadFromKeyValue;
exports.parseWorkbookSheetsToPayloads = parseWorkbookSheetsToPayloads;
const XLSX = __importStar(require("xlsx"));
function cellToString(v) {
    if (v === null || v === undefined)
        return "";
    if (typeof v === "number")
        return String(v);
    return String(v).trim();
}
function sanitizeTemplateName(raw) {
    const s = raw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
    return (s || "template").slice(0, 512);
}
function normalizeKey(k) {
    return k
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_");
}
function rowsToKeyValue(rows) {
    const out = {};
    for (const row of rows) {
        if (!row || row.length < 1)
            continue;
        const key = normalizeKey(cellToString(row[0]));
        if (!key || key.startsWith("_"))
            continue;
        const val = row.length >= 2 ? cellToString(row[1]) : "";
        out[key] = val;
    }
    return out;
}
function shouldSkipSheet(name) {
    const n = name.trim();
    const lower = n.toLowerCase();
    return (n.startsWith("_") ||
        lower === "readme" ||
        lower === "instrucciones" ||
        lower === "ayuda");
}
function alias(kv, ...keys) {
    for (const k of keys) {
        const v = kv[k];
        if (v !== undefined && v !== "")
            return v;
    }
    return "";
}
const CATEGORIES = new Set(["UTILITY", "MARKETING", "AUTHENTICATION"]);
function buildPayloadFromKeyValue(kv, fallbackName, defaultWabaId) {
    const name = sanitizeTemplateName(alias(kv, "name", "nombre", "template_name") || fallbackName);
    const language = (alias(kv, "language", "idioma", "lang") || "es").toLowerCase();
    let category = (alias(kv, "category", "categoria", "cat") || "UTILITY").toUpperCase();
    if (!CATEGORIES.has(category))
        category = "UTILITY";
    const wabaId = (alias(kv, "waba_id", "wabaid", "waba") ||
        defaultWabaId ||
        "").trim();
    if (!wabaId) {
        throw new Error("Falta waba_id en la hoja o la variable YCLOUD_WABA_ID en Convex");
    }
    const body = alias(kv, "body", "texto", "cuerpo", "mensaje");
    if (!body) {
        throw new Error('Falta el cuerpo (clave body o texto) en columnas A/B');
    }
    const components = [];
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
function parseWorkbookSheetsToPayloads(buffer, defaultWabaId) {
    const wb = XLSX.read(buffer, { type: "array", cellDates: false });
    const results = [];
    for (const sheetName of wb.SheetNames) {
        if (shouldSkipSheet(sheetName))
            continue;
        const ws = wb.Sheets[sheetName];
        if (!ws)
            continue;
        const rows = XLSX.utils.sheet_to_json(ws, {
            header: 1,
            defval: "",
            raw: false,
        });
        const kv = rowsToKeyValue(rows);
        const fallback = sanitizeTemplateName(sheetName);
        try {
            const payload = buildPayloadFromKeyValue(kv, fallback, defaultWabaId);
            results.push({ sheet: sheetName, ok: true, payload });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results.push({ sheet: sheetName, ok: false, error: msg });
        }
    }
    return results;
}
//# sourceMappingURL=whatsappTemplateSheet.js.map