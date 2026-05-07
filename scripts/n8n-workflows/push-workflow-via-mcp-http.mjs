/**
 * Calls the n8n MCP HTTP endpoint (same as Cursor mcp.json "n8n-mcp") to
 * validate then update a workflow from repo SDK code + bundled arguments JSON.
 *
 * Usage:
 *   node scripts/n8n-workflows/push-workflow-via-mcp-http.mjs
 *
 * Reads ~/.cursor/mcp.json for URL + Authorization (n8n-mcp entry).
 * Reads scripts/n8n-workflows/.mcp-args-one.json { "code": "..." }.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW_ID = 'Exk76XIgxMV32ha9';
const MCP_CONFIG = path.join(process.env.HOME || '', '.cursor/mcp.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_FILE = path.join(__dirname, 'fincasya-ycloud-inbound-v4.workflow.js');
const PROMPT_JSON = path.join(__dirname, 'fincasya-n8n-consultant-system-prompt.json');

function loadMcpHttp() {
  const raw = fs.readFileSync(MCP_CONFIG, 'utf8');
  const j = JSON.parse(raw);
  const s = j.mcpServers?.['n8n-mcp'];
  if (!s || s.type !== 'http' || !s.url) {
    throw new Error('mcp.json: missing mcpServers.n8n-mcp HTTP config');
  }
  const auth = s.headers?.Authorization;
  if (!auth) {
    throw new Error('mcp.json: missing n8n-mcp headers.Authorization');
  }
  return { url: s.url, auth };
}

/** n8n MCP HTTP returns SSE: lines `data: {json}`. Tool payload is often JSON string inside result.content[0].text */
function parseMcpSseBody(text) {
  const dataLines = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6));
  if (dataLines.length === 0) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`No SSE data: lines and not JSON (${text.length} chars)`);
    }
  }
  let outer;
  for (const line of dataLines) {
    try {
      outer = JSON.parse(line);
    } catch {
      continue;
    }
  }
  if (!outer) throw new Error('Could not parse any data: line as JSON');
  if (outer.error) throw new Error(JSON.stringify(outer.error, null, 2));
  const innerText = outer.result?.content?.find((c) => c.type === 'text')?.text;
  if (typeof innerText === 'string') {
    try {
      return JSON.parse(innerText);
    } catch {
      return { _rawText: innerText, _outer: outer };
    }
  }
  return outer.result ?? outer;
}

async function mcpCall(name, args) {
  const { url, auth } = loadMcpHttp();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: auth,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 2000)}`);
  }
  const parsed = parseMcpSseBody(text);
  if (parsed && typeof parsed === 'object' && '_rawText' in parsed) {
    throw new Error(`Unexpected MCP shape: ${String(parsed._rawText).slice(0, 800)}`);
  }
  return parsed;
}

/** Remote n8n MCP validator does not support `createRequire`; inline prompt from JSON. */
function buildBundledWorkflowCode() {
  const full = fs.readFileSync(WORKFLOW_FILE, 'utf8');
  const { prompt } = JSON.parse(fs.readFileSync(PROMPT_JSON, 'utf8'));
  const body = String(prompt ?? '').trimEnd();
  if (body.length < 5000) {
    throw new Error(
      'Prompt JSON too short. From fincasya-new run: bun run n8n:sync-consultant-prompt',
    );
  }
  const marker = "} from '@n8n/workflow-sdk';";
  const sdkEnd = full.indexOf(marker);
  if (sdkEnd === -1) throw new Error('workflow: SDK import block not found');
  const afterSdk = sdkEnd + marker.length;
  const preamble = full
    .slice(0, afterSdk)
    .replace(/^import \{ createRequire \} from 'node:module';\r?\n?/m, '');
  const idx = full.indexOf('const parseJs');
  if (idx === -1) throw new Error('workflow: const parseJs not found');
  const tailFromParseJs = full.slice(idx);
  // n8n MCP SDK parser rejects top-level IfStatement; length is checked above.
  return (
    `${preamble}\n\n` +
    `/** Inlined from fincasya-n8n-consultant-system-prompt.json for n8n MCP (validator has no createRequire). Regenerate: bun run n8n:sync-consultant-prompt */\n` +
    `const consultantPromptBody = ${JSON.stringify(body)};\n\n` +
    tailFromParseJs
  );
}

const code = buildBundledWorkflowCode();

const validated = await mcpCall('validate_workflow', { code });
if (!validated?.valid) {
  console.error('validate_workflow failed:', JSON.stringify(validated, null, 2));
  process.exit(1);
}
console.log('validate_workflow OK', { nodeCount: validated.nodeCount, warnings: validated.warnings?.length ?? 0 });

const updated = await mcpCall('update_workflow', {
  workflowId: WORKFLOW_ID,
  code,
  description: 'YCloud inbound WhatsApp: parse, dedup, agent, merge phoneE164, dispatch text/catalog.',
});
console.log('update_workflow OK', updated);
