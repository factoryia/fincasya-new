import type { GenerateReplyResult } from "../bot/replies";

const SHORT_GREETING_PREFIX = /^(?:🙋‍♂️|👋)[^\n]*\n+/u;

export function stripBotGreetingPrefix(text: string): string {
  return String(text ?? "")
    .replace(SHORT_GREETING_PREFIX, "")
    .trim();
}

/**
 * Evita burbujas redundantes en el mismo turno (p. ej. solo "datos faltantes"
 * y luego "saludo + datos faltantes").
 */
export function dedupeGenerateReplyResult(
  result: GenerateReplyResult,
): GenerateReplyResult {
  let reply = String(result.reply ?? "").trim();
  let extras = (result.extras ?? [])
    .map((e) => String(e ?? "").trim())
    .filter(Boolean);
  if (!extras.length) return { reply };

  const core = (s: string) => stripBotGreetingPrefix(s);

  extras = extras.filter((extra) => {
    const replyCore = core(reply);
    const extraCore = core(extra);
    if (!replyCore || !extraCore) return true;
    if (replyCore === extraCore) return extra.length <= reply.length;
    if (extraCore.includes(replyCore) && extra.length > reply.length) {
      return false;
    }
    if (replyCore.includes(extraCore) && reply.length > extra.length) {
      return false;
    }
    return true;
  });

  for (const extra of extras) {
    if (core(extra) === core(reply) && extra.length > reply.length) {
      reply = extra;
      extras = extras.filter((e) => e !== extra);
      break;
    }
  }

  return { reply, extras: extras.length ? extras : undefined };
}

export type DeliverTextResult = {
  wamid?: string;
  status?: string;
};
