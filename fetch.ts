import { ConvexHttpClient } from 'convex/browser';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { api } from './convex/_generated/api.js';

const client = new ConvexHttpClient(process.env.CONVEX_URL);

async function run() {
  const titles = await client.query(api.getMissingVideos.default);
  titles.forEach((t) => console.log(t));
}
run();
