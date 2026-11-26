/**
 * Desktop ⇄ phone photo handoff for the "Upload from mobile" QR.
 * In-memory, short-lived (15 min). Desktop registers a session, phone uploads, desktop polls and picks up the photo.
 */
const TTL = 15 * 60 * 1000;
const MAX = 12 * 1024 * 1024;
const store = new Map(); // sid -> { at, meta, state, photo, type }

export const validSid = (sid) => /^[a-z0-9]{16,48}$/.test(String(sid || ""));

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL) store.delete(k);
}
setInterval(sweep, 60 * 1000).unref?.();

const get = (sid) => {
  let s = store.get(sid);
  if (!s) { s = { at: Date.now(), meta: {}, state: "waiting" }; store.set(sid, s); }
  return s;
};

export function setMeta(sid, meta) {
  const s = get(sid);
  const str = (v, n) => String(v || "").slice(0, n);
  const img = str(meta.i, 600);
  s.meta = { t: str(meta.t, 140), mode: str(meta.mode, 12), i: /^https:\/\//.test(img) ? img : "", shop: str(meta.shop, 120) };
  s.at = Date.now();
}
export function markOpened(sid) { const s = get(sid); if (s.state === "waiting") s.state = "opened"; return s.meta; }
export function markUploading(sid) { const s = get(sid); if (!s.photo) s.state = "uploading"; }
export function putPhoto(sid, buf, type) {
  if (buf.length > MAX) throw new Error("Photo is too large");
  const s = get(sid);
  s.photo = buf; s.type = type || "image/jpeg"; s.state = "ready"; s.at = Date.now();
}
export function status(sid) { const s = store.get(sid); return s ? s.state : "waiting"; }
export function takePhoto(sid) {
  const s = store.get(sid);
  if (!s?.photo) return null;
  const out = { buf: s.photo, type: s.type };
  s.state = "taken";
  setTimeout(() => store.delete(sid), 60 * 1000).unref?.();
  return out;
}
