import { prisma } from "../shopify.server";

const OFFLINE = "urn:shopify:params:oauth:token-type:offline-access-token";

/**
 * Exchange one stored NON-expiring offline token for an expiring pair (Option 2 of Shopify migration guide).
 * Returns true if the session now has an expiring token (or already had one).
 * Dead tokens (invalid_subject_token = uninstalled/revoked) are deleted so they're never sent again;
 * a fresh expiring token is issued automatically when the merchant reopens the app.
 */
async function migrateSession(s) {
  const clientId = process.env.SHOPIFY_API_KEY, clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) return false;
  try {
    const res = await fetch(`https://${s.shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: clientId, client_secret: clientSecret,
        subject_token: s.accessToken,
        subject_token_type: OFFLINE,
        requested_token_type: OFFLINE,
        expiring: "1",
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) {
      console.error("[token-migrate] FAIL", s.shop, res.status, JSON.stringify(d));
      if (d.error === "invalid_subject_token" || res.status === 401 || res.status === 404) {
        await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
        console.log("[token-migrate] removed dead token", s.shop);
      }
      return false;
    }
    const now = Date.now();
    await prisma.session.update({
      where: { id: s.id },
      data: {
        accessToken: d.access_token,
        scope: d.scope ?? s.scope,
        expires: d.expires_in ? new Date(now + d.expires_in * 1000) : null,
        refreshToken: d.refresh_token ?? null,
        refreshTokenExpires: d.refresh_token_expires_in ? new Date(now + d.refresh_token_expires_in * 1000) : null,
      },
    });
    console.log("[token-migrate] OK", s.shop);
    return true;
  } catch (e) {
    console.error("[token-migrate] ERR", s.shop, e.message);
    return false;
  }
}

/** Guard before any background Admin API call: never send a non-expiring token. */
export async function ensureExpiringToken(shop) {
  const s = await prisma.session.findFirst({ where: { shop, isOnline: false } });
  if (!s) return false;
  if (s.refreshToken) return true;
  return migrateSession(s);
}

/** Migrate every remaining non-expiring offline token. Safe to re-run. */
export async function migrateOfflineTokens() {
  let sessions = [];
  try { sessions = await prisma.session.findMany({ where: { isOnline: false, refreshToken: null } }); }
  catch (e) { console.error("[token-migrate] query failed:", e.message); return; }
  if (!sessions.length) return console.log("[token-migrate] all offline tokens are expiring ✓");
  console.log(`[token-migrate] ${sessions.length} non-expiring offline token(s) to migrate`);
  for (const s of sessions) await migrateSession(s);
}
