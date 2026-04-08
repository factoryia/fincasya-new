export declare function sanitizeTemplateName(raw: string): string;
export declare function rowsToKeyValue(rows: unknown[][]): Record<string, string>;
export declare function shouldSkipSheet(name: string): boolean;
export declare function buildPayloadFromKeyValue(kv: Record<string, string>, fallbackName: string, defaultWabaId?: string): Record<string, unknown>;
export type ParsedSheetOk = {
    sheet: string;
    ok: true;
    payload: Record<string, unknown>;
};
export type ParsedSheetErr = {
    sheet: string;
    ok: false;
    error: string;
};
export type ParsedSheet = ParsedSheetOk | ParsedSheetErr;
export declare function parseWorkbookSheetsToPayloads(buffer: ArrayBuffer, defaultWabaId?: string): ParsedSheet[];
