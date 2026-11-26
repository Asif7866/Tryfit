import Jimp from "jimp";
import { getGuide } from "../lib/guides.server";

// GET /guide/:name        → 302 to the AI image (storefront fallback)
// GET /guide/:name?w=360  → resized JPEG bytes (used by scripts/pull-guides.mjs to save into extension assets)
export const loader = async ({ params, request }) => {
  const name = String(params.name || "").replace(/\.(jpe?g|png|webp)$/i, "");
  try {
    const url = await getGuide(name);
    const w = Math.min(800, Math.max(120, Number(new URL(request.url).searchParams.get("w")) || 0));
    if (new URL(request.url).searchParams.has("w")) {
      const im = await Jimp.read(url);
      im.resize(w, Jimp.AUTO).quality(76);
      const buf = await im.getBufferAsync(Jimp.MIME_JPEG);
      return new Response(buf, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response("Unavailable", { status: e?.message === "unknown guide" ? 404 : 503, headers: { "Cache-Control": "no-store" } });
  }
};
