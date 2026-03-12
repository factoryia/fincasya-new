import { query } from './_generated/server';

export default query({
  args: {},
  handler: async (ctx) => {
    const allProperties = await ctx.db.query('properties').collect();
    const missingVideo = allProperties.filter(
      (p) => !p.video || p.video.trim() === '',
    );
    return missingVideo.map((p) => p.title);
  },
});
