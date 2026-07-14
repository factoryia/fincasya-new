import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const checkSlugs = query({
  args: {},
  handler: async (ctx) => {
    const fincas = await ctx.db.query("properties").collect();
    return fincas.map(f => ({ title: f.title, slug: f.slug }));
  },
});

export const listAudioMessages = query({
  args: {},
  handler: async (ctx) => {
    const byType = await ctx.db
      .query("messages")
      .filter((q) => q.eq(q.field("type"), "audio"))
      .collect();
    const byContent = await ctx.db
      .query("messages")
      .filter((q) => q.eq(q.field("content"), "[Audio]"))
      .collect();
    const all = [...byType, ...byContent];
    const seen = new Set<string>();
    return all
      .filter((m) => {
        if (seen.has(m._id)) return false;
        seen.add(m._id);
        return true;
      })
      .map((m) => ({
        id: m._id,
        conversationId: m.conversationId,
        sender: m.sender,
        type: m.type,
        mediaUrl: m.mediaUrl,
        content: m.content,
        createdAt: m.createdAt,
      }));
  },
});

export const countMessages = query({
  args: {},
  handler: async (ctx) => {
    const msgs = await ctx.db.query("messages").take(5000);
    return { total: msgs.length };
  },
});

export const _audioChunk = internalQuery({
  args: { afterTime: v.optional(v.number()) },
  handler: async (ctx, { afterTime }) => {
    let q = ctx.db.query("messages").order("asc");
    const rows = afterTime != null
      ? await (q as typeof q).filter((f) => f.gt(f.field("_creationTime"), afterTime)).take(2000)
      : await q.take(2000);

    const audio = rows.filter(
      (m) => m.type === "audio" || m.content === "[Audio]",
    );
    const lastTime: number | null =
      rows.length > 0 ? rows[rows.length - 1]._creationTime : null;
    const exhausted = rows.length < 2000;
    return { audio, lastTime, exhausted };
  },
});

export const collectAllAudios = action({
  args: {},
  handler: async (ctx): Promise<Array<{
    id: string;
    conversationId: string;
    sender: string;
    type: string | undefined;
    mediaUrl: string | undefined;
    content: string;
    createdAt: number;
  }>> => {
    const all: Array<{
      id: string;
      conversationId: string;
      sender: string;
      type: string | undefined;
      mediaUrl: string | undefined;
      content: string;
      createdAt: number;
    }> = [];
    let afterTime: number | undefined = undefined;
    let iterations = 0;
    while (iterations < 100) {
      const result = (await ctx.runQuery(
        internal.debug._audioChunk,
        { afterTime },
      )) as { audio: Array<{ _id: string; conversationId: unknown; sender: string; type?: string; mediaUrl?: string; content: string; createdAt: number; _creationTime: number }>; lastTime: number | null; exhausted: boolean };
      const audio = result.audio;
      const lastTime: number | null = result.lastTime;
      const exhausted: boolean = result.exhausted;
      for (const m of audio) {
        all.push({
          id: m._id,
          conversationId: m.conversationId as string,
          sender: m.sender,
          type: m.type,
          mediaUrl: m.mediaUrl,
          content: m.content,
          createdAt: m.createdAt,
        });
      }
      if (exhausted || lastTime == null) break;
      afterTime = lastTime;
      iterations++;
    }
    return all;
  },
});
