import { json } from "@remix-run/node";
import { guideStatus, warmGuides } from "../lib/guides.server";

// Open https://tryfit-production.up.railway.app/guide-status to see which guide photos are ready. Add ?retry=1 to regenerate missing ones.
export const loader = async ({ request }) => {
  if (new URL(request.url).searchParams.get("retry")) warmGuides().catch(() => {});
  return json(await guideStatus(), { headers: { "Cache-Control": "no-store" } });
};
