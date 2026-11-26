import { json } from "@remix-run/node";
import { validSid, setMeta, status, takePhoto, putPhoto, markUploading } from "../lib/handoff.server";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" };

// GET  /handoff/:sid          → { state }   (desktop polls)
// GET  /handoff/:sid?photo=1  → image bytes (desktop picks up once)
export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!validSid(params.sid)) return json({ error: "bad session" }, { status: 400, headers: CORS });
  if (new URL(request.url).searchParams.get("photo")) {
    const p = takePhoto(params.sid);
    if (!p) return json({ error: "not ready" }, { status: 404, headers: CORS });
    return new Response(p.buf, { headers: { ...CORS, "Content-Type": p.type } });
  }
  return json({ state: status(params.sid) }, { headers: CORS });
};

// POST /handoff/:sid  JSON {t,i,mode,shop}  → register (desktop)
// POST /handoff/:sid  multipart photo       → upload (phone)
// POST /handoff/:sid  JSON {uploading:true} → phone started uploading
export const action = async ({ request, params }) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!validSid(params.sid)) return json({ error: "bad session" }, { status: 400, headers: CORS });
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await request.json();
      if (body.uploading) markUploading(params.sid); else setMeta(params.sid, body);
      return json({ ok: true }, { headers: CORS });
    }
    const fd = await request.formData();
    const f = fd.get("photo");
    if (!f || typeof f === "string" || !String(f.type).startsWith("image/")) return json({ error: "No photo" }, { status: 400, headers: CORS });
    putPhoto(params.sid, Buffer.from(await f.arrayBuffer()), f.type);
    return json({ ok: true }, { headers: CORS });
  } catch (e) {
    return json({ error: e.message || "Upload failed" }, { status: 400, headers: CORS });
  }
};
