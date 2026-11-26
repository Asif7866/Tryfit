import { getGuide } from "../lib/guides.server";

export const loader = async ({ params }) => {
  const name = String(params.name || "").replace(/\.(jpe?g|png|webp)$/i, "");
  try {
    const url = await getGuide(name);
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response("Unavailable", { status: e?.message === "unknown guide" ? 404 : 503, headers: { "Cache-Control": "no-store" } });
  }
};
