// One-time: convert stored NON-expiring offline tokens to expiring ones (Shopify Jan 1, 2027 requirement).
// Safe to re-run: skips sessions that already have a refresh token.
// Usage (Railway console):  node scripts/migrate-offline-tokens.mjs           (dry run)
//                           node scripts/migrate-offline-tokens.mjs --apply   (writes)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const { SHOPIFY_API_KEY: clientId, SHOPIFY_API_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) { console.error("Missing SHOPIFY_API_KEY / SHOPIFY_API_SECRET"); process.exit(1); }

const sessions = await prisma.session.findMany({ where: { isOnline: false, refreshToken: null } });
console.log(`${sessions.length} offline session(s) on non-expiring tokens${APPLY ? "" : " (dry run)"}`);

let ok = 0, fail = 0;
for (const s of sessions) {
  if (!APPLY) { console.log("would migrate:", s.shop); continue; }
  try {
    const res = await fetch(`https://${s.shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: clientId,
        client_secret: clientSecret,
        subject_token: s.accessToken,
        subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
        requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
        expiring: "1",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) { fail++; console.error("FAIL", s.shop, res.status, JSON.stringify(data)); continue; }
    const now = Date.now();
    await prisma.session.update({
      where: { id: s.id },
      data: {
        accessToken: data.access_token,
        scope: data.scope ?? s.scope,
        expires: data.expires_in ? new Date(now + data.expires_in * 1000) : null,
        refreshToken: data.refresh_token ?? null,
        refreshTokenExpires: data.refresh_token_expires_in ? new Date(now + data.refresh_token_expires_in * 1000) : null,
      },
    });
    ok++; console.log("OK", s.shop);
  } catch (e) { fail++; console.error("ERR", s.shop, e.message); }
}
if (APPLY) console.log(`done: ${ok} migrated, ${fail} failed (failed shops migrate automatically next time they open the app)`);
await prisma.$disconnect();
