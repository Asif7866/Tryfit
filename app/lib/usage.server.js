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

  const pctInt = Math.min(Math.round(pct * 100), 100);
  const barColor = remaining === 0 ? "#d72c0d" : "#b98900";
  const planLabel = (s.plan || "free").charAt(0).toUpperCase() + (s.plan || "free").slice(1);
  const headline = remaining === 0 ? "Your try-on limit is reached" : `${remaining} try-on${remaining === 1 ? "" : "s"} left this cycle`;
  const body = remaining === 0
    ? "Shoppers on your store will see a limit message on the try-on button until you upgrade or your cycle resets."
    : "At your current pace you may run out before the cycle resets. Upgrade now so virtual try-on stays available for every shopper.";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#202223">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f6f7;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e1e3e5;overflow:hidden">
  <tr><td style="padding:24px 32px 0">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="width:32px;height:32px;background:#303030;border-radius:8px;color:#fff;font-weight:700;font-size:15px;text-align:center;vertical-align:middle">T</td>
      <td style="padding-left:10px;font-weight:600;font-size:15px">TryFit</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 32px 8px">
    <h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600">${headline}</h1>
  </td></tr>
  <tr><td style="padding:0 32px 20px;font-size:14px;line-height:22px;color:#4a4a4a">${body}</td></tr>
  <tr><td style="padding:0 32px 24px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f6f7;border-radius:8px">
      <tr><td style="padding:16px 18px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
          <td style="font-size:13px;color:#6d7175">${slug} · ${planLabel} plan</td>
          <td align="right" style="font-size:13px;font-weight:600">${s.monthlyTryOns} / ${s.monthlyLimit} used</td>
        </tr></table>
        <div style="margin-top:10px;height:8px;background:#e1e3e5;border-radius:999px;overflow:hidden">
          <div style="width:${pctInt}%;height:8px;background:${barColor};border-radius:999px"></div>
        </div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 28px">
    <a href="${pricingUrl}" style="display:inline-block;background:#303030;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Upgrade plan</a>
    <span style="display:inline-block;margin-left:14px;font-size:13px;color:#6d7175">Takes less than a minute</span>
  </td></tr>
  <tr><td style="padding:18px 32px;border-top:1px solid #e1e3e5;font-size:12px;line-height:18px;color:#8c9196">
    You're receiving this because TryFit is installed on your Shopify store. Your usage resets every 30 days.
    <br>Questions? Reply to this email or <a href="https://wa.me/917002073054" style="color:#6d7175">chat with us</a>.
  </td></tr>
</table>
</td></tr></table></body></html>`;

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
