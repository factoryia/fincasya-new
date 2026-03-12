import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const client = new ConvexHttpClient(process.env.CONVEX_URL);

async function run() {
  const titles = await client.query("getMissingVideos");
  titles.forEach(t => console.log(t));
}
run();
