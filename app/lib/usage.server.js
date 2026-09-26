import { prisma } from "../shopify.server";

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/**
 * Lazy monthly reset — no cron needed.
 * Resets monthlyTryOns + usageAlertSent if 30 days passed since lastResetAt.
 * Returns fresh settings row.
 */
export async function ensureMonthlyReset(shop) {
  const s = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!s) return null;
  const now = Date.now();
  const last = s.lastResetAt ? new Date(s.lastResetAt).getTime() : null;
  if (!last) {
    return prisma.shopSettings.update({ where: { shop }, data: { lastResetAt: new Date(now) } });
  }
  if (now - last >= THIRTY_DAYS) {
    return prisma.shopSettings.update({
      where: { shop },
      data: { monthlyTryOns: 0, usageAlertSent: false, lastResetAt: new Date(now) },
    });
  }
  return s;
}

/**
 * Send 80% usage alert via Resend (once per cycle). Silent on failure.
 */
export async function maybeSendUsageAlert(shop) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const s = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!s || !s.merchantEmail || s.usageAlertSent || s.monthlyLimit <= 0) return;
  const pct = s.monthlyTryOns / s.monthlyLimit;
  if (pct < 0.8) return;

  const remaining = Math.max(s.monthlyLimit - s.monthlyTryOns, 0);
  const slug = shop.replace(".myshopify.com", "");
  const pricingUrl = `https://admin.shopify.com/store/${slug}/charges/tryfit-5/pricing_plans`;
  const from = process.env.EMAIL_FROM || "TryFit <onboarding@resend.dev>";
  const subject = remaining === 0 ? "TryFit: monthly try-on limit reached" : `TryFit: only ${remaining} try-ons left this month`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#202223">
    <h2 style="margin:0 0 12px;font-size:20px">${remaining === 0 ? "Your shoppers can't try on right now" : "You're running low on try-ons"}</h2>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
      <strong>${s.monthlyTryOns} of ${s.monthlyLimit}</strong> try-ons used on <strong>${slug}</strong> this cycle.
      ${remaining === 0 ? "The try-on button will show a limit message until you upgrade or the cycle resets." : "Upgrade now so virtual try-on stays active for your shoppers."}
    </p>
    <a href="${pricingUrl}" style="display:inline-block;background:#303030;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px">Upgrade plan</a>
    <p style="margin:24px 0 0;font-size:12px;color:#6d7175">Sent by TryFit · Virtual try-on for Shopify</p>
  </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [s.merchantEmail], subject, html }),
    });
    if (res.ok) {
      await prisma.shopSettings.update({ where: { shop }, data: { usageAlertSent: true } });
    } else {
      console.error("Resend error:", res.status, await res.text());
    }
  } catch (e) {
    console.error("Usage alert failed:", e.message);
  }
}
