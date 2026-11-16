import { prisma } from "../shopify.server";

/**
 * Converts stored NON-expiring offline tokens to expiring ones (Shopify requirement for all public apps).
 * Runs once at boot in the background; safe to re-run (skips sessions that already have a refresh token).
 * Shops that fail here migrate automatically the next time the merchant opens the app.
 */
export async function migrateOfflineTokens() {
  const clientId = process.env.SHOPIFY_API_KEY, clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) return;
  let sessions = [];
  try { sessions = await prisma.session.findMany({ where: { isOnline: false, refreshToken: null } }); }
  catch (e) { console.error("[token-migrate] query failed:", e.message); return; }
  if (!sessions.length) return;
  console.log(`[token-migrate] ${sessions.length} non-expiring offline token(s) to migrate`);
  for (const s of sessions) {
    try {
      const res = await fetch(`https://${s.shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          client_id: clientId, client_secret: clientSecret,
          subject_token: s.accessToken,
          subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
          requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
          expiring: "1",
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.access_token) { console.error("[token-migrate] FAIL", s.shop, res.status, JSON.stringify(d)); continue; }
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
    } catch (e) { console.error("[token-migrate] ERR", s.shop, e.message); }
  }
}
