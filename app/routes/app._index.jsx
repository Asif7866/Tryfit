import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, InlineGrid, Box,
  Badge, Button, ProgressBar, Divider, Thumbnail, EmptyState, Banner,
  DataTable, Link as PolarisLink, Checkbox, ButtonGroup,
} from "@shopify/polaris";
import shopify, { prisma } from "../shopify.server";
import { ensureMonthlyReset } from "../lib/usage.server";
import { PLAN_LIMITS, syncPlanFromShopify, planKeyFromName, planLabel } from "../lib/plans.server";
import { buildAnalytics } from "../lib/analytics.server";

const APP_HANDLE = "tryfit-5";
const THEME_EXT_UID = "83bb5402-d1c3-404c-b6bf-94b8bc49f12e65c66f66";


export const action = async ({ request }) => {
  const { session } = await shopify.authenticate.admin(request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  const data = {};
  if (intent === "theme_added") data.themeBlockAdded = fd.get("value") === "1";
  if (intent === "dismiss_onboarding") data.onboardingDismissed = true;
  if (Object.keys(data).length) {
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: data,
      create: { shop: session.shop, enabled: true, ...data },
    });
  }
  return json({ ok: true });
};

export const loader = async ({ request }) => {
  let authenticatedShop = null;
  try {
    const reqUrl = new URL(request.url);
    const sp = reqUrl.searchParams.get("shop") || reqUrl.searchParams.get("myshopify_domain");
    if (sp) authenticatedShop = sp;
    if (!authenticatedShop) {
      const h = reqUrl.searchParams.get("host");
      if (h) { const d = atob(h); const m = d.match(/([^/]+\.myshopify\.com)/); if (m) authenticatedShop = m[1]; }
    }
  } catch (_) {}

  try {
    const { admin, session } = await shopify.authenticate.admin(request);
    authenticatedShop = session.shop;
    const shop = session.shop;

    // 1. Billing
    const billingRes = await admin.graphql(`{ appInstallation { activeSubscriptions { id name status test } } }`);
    const billingData = await billingRes.json();
    const activeSubs = billingData.data?.appInstallation?.activeSubscriptions || [];
    const hasPaidPlan = activeSubs.some(s => s.status === "ACTIVE" && s.name && s.name.toLowerCase() !== "free");

    const existing = await prisma.shopSettings.findUnique({ where: { shop } });
    const hasChosenPlan = existing?.planChosen === true;
    const chargeId = new URL(request.url).searchParams.get("charge_id");

    if (!hasPaidPlan && !hasChosenPlan) {
      if (chargeId) {
        await prisma.shopSettings.upsert({ where: { shop }, update: { planChosen: true }, create: { shop, planChosen: true, enabled: true } });
      } else {
        const shopSlug = shop.replace(".myshopify.com", "");
        // Mark as shown now: Shopify doesn't always append charge_id when the Free plan is picked,
        // so the next open goes to the dashboard instead of looping back to the pricing page.
        await prisma.shopSettings.upsert({ where: { shop }, update: { planChosen: true }, create: { shop, planChosen: true, enabled: true, lastResetAt: new Date() } });
        return json({ requiresPlan: true, pricingUrl: `https://admin.shopify.com/store/${shopSlug}/charges/${APP_HANDLE}/pricing_plans`, shop });
      }
    }

    const activePlan = activeSubs.find(s => s.status === "ACTIVE");
    const planKey = planKeyFromName(activePlan?.name || "free");
    const planName = planLabel(planKey);
    const monthlyLimit = PLAN_LIMITS[planKey] || 10;

    // 2. Merchant email (for usage alerts) + products
    let merchantEmail = null;
    const [shopRes, prodRes] = await Promise.all([
      admin.graphql(`{ shop { email currencyCode timezoneOffsetMinutes } }`),
      admin.graphql(`{
        products(first: 6, sortKey: UPDATED_AT, reverse: true) {
          edges { node { id title status featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } } } }
        }
        productsCount { count }
      }`),
    ]);
    let shopInfo = {};
    try { shopInfo = (await shopRes.json()).data?.shop || {}; merchantEmail = shopInfo.email || null; } catch (e) {}
    const prodData = await prodRes.json();
    const products = (prodData.data?.products?.edges || []).map(e => e.node);
    const totalProducts = prodData.data?.productsCount?.count || products.length;
    const currencyCode = shopInfo.currencyCode || products[0]?.priceRangeV2?.minVariantPrice?.currencyCode || "INR";

    // 3. Sync plan + email, lazy monthly reset
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { plan: planKey, monthlyLimit, enabled: true, ...(merchantEmail ? { merchantEmail } : {}) },
      create: { shop, plan: planKey, monthlyLimit, enabled: true, merchantEmail, lastResetAt: new Date() },
    });
    const settings = await ensureMonthlyReset(shop);

    // 4. Analytics
    const days = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("range"))) ? Number(new URL(request.url).searchParams.get("range")) : 30;
    const analytics = await buildAnalytics(shop, days, shopInfo.timezoneOffsetMinutes ?? 330);
    // product images for the top-products table
    let images = {};
    try {
      const ids = analytics.top.map((p) => `gid://shopify/Product/${p.id}`).filter((g) => /\d+$/.test(g));
      if (ids.length) {
        const r = await admin.graphql(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id featuredImage { url(transform:{maxWidth:120}) } handle } } }`, { variables: { ids } });
        for (const n of (await r.json()).data?.nodes || []) if (n?.id) images[n.id.split("/").pop()] = { img: n.featuredImage?.url || null, handle: n.handle };
      }
    } catch (e) {}
    const allTimeTryOns = settings?.totalTryOns || 0;

    return json({
      shop, products, totalProducts, currencyCode, analytics, images,
      monthlyTryOns: settings?.monthlyTryOns || 0, monthlyLimit, plan: planName,
      cycleStart: settings?.lastResetAt || null, allTimeTryOns,
      onboarding: {
        planChosen: hasPaidPlan || hasChosenPlan,
        themeBlockAdded: settings?.themeBlockAdded || allTimeTryOns > 0,
        tested: allTimeTryOns > 0,
        dismissed: settings?.onboardingDismissed || false,
      },
    });
  } catch (e) {
    // Log the real reason (visible in Railway logs), then fall back to DB data
    try {
      const u = new URL(request.url);
      if (e instanceof Response) {
        console.error("[AUTH FAIL]", e.status, u.pathname, "params:", [...u.searchParams.keys()].join(","),
          "authHeader:", !!request.headers.get("authorization"), "hdrs:", JSON.stringify(Object.fromEntries(e.headers)));
      } else {
        console.error("[LOADER ERR]", e?.message || e);
      }
    } catch (_) {}
    // Non-auth failure — DB-only fallback, strictly filtered by shop
    const shopName = authenticatedShop;
    let fb = {
      shop: shopName || "unknown", products: [], totalProducts: 0, currencyCode: "INR",
      monthlyTryOns: 0, monthlyLimit: 10, plan: "Free", analytics: null, images: {}, cycleStart: null, allTimeTryOns: 0,
      onboarding: { planChosen: true, themeBlockAdded: true, tested: true, dismissed: true }, fallback: true,
    };
    try {
      if (shopName) {
        // Admin session failed — still pull the real plan from Shopify via the stored offline token
        let settings = await syncPlanFromShopify(shopName);
        if (!settings) settings = await prisma.shopSettings.findUnique({ where: { shop: shopName } });
        // Plan selection must never be skipped: returning from Shopify's pricing page marks it chosen,
        // otherwise a shop that hasn't chosen a plan is sent to the pricing page before any dashboard.
        const chargeId = new URL(request.url).searchParams.get("charge_id");
        if (chargeId) {
          settings = await prisma.shopSettings.upsert({ where: { shop: shopName }, update: { planChosen: true }, create: { shop: shopName, planChosen: true, enabled: true } });
        } else if (!settings?.planChosen) {
          const slug = shopName.replace(".myshopify.com", "");
          await prisma.shopSettings.upsert({ where: { shop: shopName }, update: { planChosen: true }, create: { shop: shopName, planChosen: true, enabled: true, lastResetAt: new Date() } });
          return json({ requiresPlan: true, pricingUrl: `https://admin.shopify.com/store/${slug}/charges/${APP_HANDLE}/pricing_plans`, shop: shopName });
        }
        const days = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("range"))) ? Number(new URL(request.url).searchParams.get("range")) : 30;
        const analytics = await buildAnalytics(shopName, days, 330);
        fb = { ...fb, shop: shopName, analytics, monthlyTryOns: settings?.monthlyTryOns || 0,
          monthlyLimit: PLAN_LIMITS[String(settings?.plan || "free").toLowerCase()] || settings?.monthlyLimit || 10,
          plan: (p => p.charAt(0).toUpperCase() + p.slice(1))(String(settings?.plan || "free")),
          cycleStart: settings?.lastResetAt || null, allTimeTryOns: settings?.totalTryOns || 0 };
      }
    } catch (_) {}
    return json(fb);
  }
};

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const fmtN = (n) => Number(n || 0).toLocaleString();
const fmtMoney = (sym, n) => `${sym}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const INK = "#303030", MUTED = "#8A8A8A", LINE = "#EBEBEB", ACCENT = "#2C6ECB", ACCENT2 = "#29845A";

/* ── small, dependency-free charts ── */
function Delta({ v, pts }) {
  if (v === null || v === undefined || !isFinite(v) || Math.abs(v) < 0.05) return <Text as="span" variant="bodyXs" tone="subdued">— vs prev.</Text>;
  const up = v > 0;
  return <Text as="span" variant="bodyXs" tone={up ? "success" : "critical"}>{up ? "↑" : "↓"} {Math.abs(v).toFixed(pts ? 1 : 0)}{pts ? " pts" : "%"} <span style={{ color: MUTED }}>vs prev.</span></Text>;
}
function Kpi({ label, value, d, pts, hint }) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="300">
      <BlockStack gap="150">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="headingXl">{value}</Text>
        {hint ? <Text as="p" variant="bodyXs" tone="subdued">{hint}</Text> : <Delta v={d} pts={pts} />}
      </BlockStack>
    </Box>
  );
}
function TrendChart({ data }) {
  const W = 720, H = 200, P = { l: 30, r: 8, t: 12, b: 24 };
  const max = Math.max(4, ...data.map((d) => Math.max(d.tryOns, d.atc)));
  const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, data.length - 1);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const line = (k) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join("");
  const area = `${line("tryOns")}L${x(data.length - 1)},${H - P.b}L${x(0)},${H - P.b}Z`;
  const ticks = [0, Math.round(max / 2), max];
  const every = Math.ceil(data.length / 7);
  const [hover, setHover] = useState(null);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - P.l) / (W - P.l - P.r)) * (data.length - 1)); setHover(Math.max(0, Math.min(data.length - 1, i))); }}>
        <defs><linearGradient id="tfA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ACCENT} stopOpacity=".22" /><stop offset="1" stopColor={ACCENT} stopOpacity="0" /></linearGradient></defs>
        {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={LINE} /><text x={P.l - 6} y={y(t) + 4} fontSize="10" textAnchor="end" fill={MUTED}>{t}</text></g>)}
        <path d={area} fill="url(#tfA)" />
        <path d={line("tryOns")} fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinejoin="round" />
        <path d={line("atc")} fill="none" stroke={ACCENT2} strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" />
        {data.map((d, i) => (i % every === 0 || i === data.length - 1) && <text key={d.date} x={x(i)} y={H - 6} fontSize="10" textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} fill={MUTED}>{new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>)}
        {hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#C9C9C9" /><circle cx={x(hover)} cy={y(data[hover].tryOns)} r="4" fill={ACCENT} /><circle cx={x(hover)} cy={y(data[hover].atc)} r="3.5" fill={ACCENT2} /></g>}
      </svg>
      {hover !== null && (
        <div style={{ position: "absolute", top: 0, left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > data.length / 2 ? "-105%" : "5%"})`, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 14px rgba(0,0,0,.08)", pointerEvents: "none", whiteSpace: "nowrap" }}>
          <Text as="p" variant="bodyXs" tone="subdued">{new Date(data[hover].date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</Text>
          <Text as="p" variant="bodySm"><span style={{ color: ACCENT }}>●</span> {data[hover].tryOns} try-ons</Text>
          <Text as="p" variant="bodySm"><span style={{ color: ACCENT2 }}>●</span> {data[hover].atc} add to cart</Text>
        </div>
      )}
      <InlineStack gap="400"><Text as="span" variant="bodyXs" tone="subdued"><span style={{ color: ACCENT }}>━</span> Try-ons</Text><Text as="span" variant="bodyXs" tone="subdued"><span style={{ color: ACCENT2 }}>┅</span> Added to cart</Text></InlineStack>
    </div>
  );
}
function BarList({ items, color = ACCENT, suffix = "" }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <BlockStack gap="250">
      {items.map((i) => (
        <BlockStack key={i.name} gap="100">
          <InlineStack align="space-between"><Text as="span" variant="bodySm">{i.name}</Text><Text as="span" variant="bodySm" fontWeight="semibold">{fmtN(i.n)}{suffix}</Text></InlineStack>
          <div style={{ height: 8, borderRadius: 99, background: "#F1F1F1", overflow: "hidden" }}><div style={{ width: `${(i.n / max) * 100}%`, height: "100%", borderRadius: 99, background: color, transition: "width .6s ease" }} /></div>
        </BlockStack>
      ))}
    </BlockStack>
  );
}
function Columns({ values, labels, highlight }) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
        {values.map((v, i) => <div key={i} title={`${labels[i]}: ${v}`} style={{ flex: 1, height: `${Math.max(4, (v / max) * 100)}%`, borderRadius: 4, background: v && i === peak ? (highlight || ACCENT) : "#D9E4F5" }} />)}
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: 6 }}>{labels.map((l, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: MUTED }}>{l}</div>)}</div>
    </div>
  );
}
const EVENT = {
  completed: { icon: "✨", text: "Tried on" },
  added_to_cart: { icon: "🛒", text: "Added to cart after try-on" },
  converted: { icon: "💰", text: "Ordered after try-on" },
  feedback_up: { icon: "👍", text: "Liked the result" },
  feedback_down: { icon: "👎", text: "Didn't like the result" },
  share: { icon: "↗", text: "Shared the look" },
};

export default function Index() {
  const d = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const [params, setParams] = useSearchParams();
  const [badgeHidden, setBadgeHidden] = useState(true);
  useEffect(() => { try { setBadgeHidden(localStorage.getItem("tf_badge_cta") === "1"); } catch (e) { setBadgeHidden(false); } }, []);
  useEffect(() => {
    if (d?.requiresPlan && d?.pricingUrl) {
      if (window.top !== window.self) window.top.location.href = d.pricingUrl; else window.location.href = d.pricingUrl;
    }
  }, [d]);

  if (d?.requiresPlan) {
    return (
      <Page>
        <Box paddingBlock="1600"><BlockStack gap="200" inlineAlign="center">
          <Text as="h2" variant="headingLg">Setting up your account…</Text>
          <Text as="p" tone="subdued">Redirecting you to choose a plan.</Text>
        </BlockStack></Box>
      </Page>
    );
  }

  const { shop, products, totalProducts, currencyCode, monthlyTryOns, monthlyLimit, plan, onboarding, cycleStart, allTimeTryOns } = d;
  const A = d.analytics || { days: 30, kpis: {}, series: [], funnel: { tryOns: 0, atc: 0, orders: 0 }, categories: [], weekday: Array(7).fill(0), hours: Array(24).fill(0), top: [], activity: [], gallery: [] };
  const K = A.kpis || {};
  const images = d.images || {};
  const range = A.days;
  const slug = shop.replace(".myshopify.com", "");
  const usagePercent = monthlyLimit > 0 ? Math.min((monthlyTryOns / monthlyLimit) * 100, 100) : 0;
  const creditsLeft = Math.max(monthlyLimit - monthlyTryOns, 0);
  const currSymbol = { USD: "$", EUR: "€", GBP: "£", INR: "₹", AED: "AED ", CAD: "CA$", AUD: "A$" }[currencyCode] || `${currencyCode} `;
  const goToPricing = () => {
    if (window.shopify?.navigate) window.shopify.navigate(`/charges/${APP_HANDLE}/pricing_plans`);
    else window.top.location.href = `https://admin.shopify.com/store/${slug}/charges/${APP_HANDLE}/pricing_plans`;
  };
  const openTab = (u) => () => window.open(u, "_blank", "noopener,noreferrer");
  const themeEditorUrl = `https://admin.shopify.com/store/${slug}/themes/current/editor?template=product&addAppBlockId=${THEME_EXT_UID}/try-on&target=mainSection`;
  const badgeEmbedUrl = `https://admin.shopify.com/store/${slug}/themes/current/editor?context=apps&template=collection&activateAppId=${THEME_EXT_UID}/card-badge`;
  const hideBadgeCta = () => { try { localStorage.setItem("tf_badge_cta", "1"); } catch (e) {} setBadgeHidden(true); };
  const planTone = plan.toLowerCase() === "free" ? "info" : ["pro", "business", "enterprise"].includes(plan.toLowerCase()) ? "success" : "attention";
  const usageTone = usagePercent >= 90 ? "critical" : usagePercent >= 70 ? "warning" : "success";
  const setRange = (r) => { const p = new URLSearchParams(params); p.set("range", String(r)); setParams(p, { preventScrollReset: true }); };
  const loading = nav.state === "loading";

  // usage forecast for the current 30-day cycle
  const cycleStartMs = cycleStart ? new Date(cycleStart).getTime() : Date.now();
  const daysIn = Math.max(1, (Date.now() - cycleStartMs) / 86400000);
  const daysLeft = Math.max(0, Math.ceil(30 - daysIn));
  const pace = monthlyTryOns / daysIn;
  const projected = Math.round(pace * 30);
  const daysToLimit = pace > 0 ? Math.floor(creditsLeft / pace) : null;
  const willRunOut = daysToLimit !== null && daysToLimit < daysLeft;

  const steps = [
    { key: "plan", label: "Choose a plan", done: onboarding.planChosen, action: <Button size="slim" onClick={goToPricing}>View plans</Button> },
    { key: "theme", label: "Add the try-on button to your product page", done: onboarding.themeBlockAdded,
      action: <InlineStack gap="200"><Button size="slim" onClick={openTab(themeEditorUrl)}>Open theme editor</Button>
        <Checkbox label="Done" checked={onboarding.themeBlockAdded} onChange={(v) => submit({ intent: "theme_added", value: v ? "1" : "0" }, { method: "post" })} /></InlineStack> },
    { key: "test", label: "Run a test try-on on your storefront", done: onboarding.tested,
      action: <Button size="slim" onClick={openTab(`https://${shop}`)}>Open store</Button> },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const showOnboarding = !onboarding.dismissed && doneCount < steps.length;
  const F = A.funnel;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const peakDay = A.weekday.some(Boolean) ? wd[A.weekday.indexOf(Math.max(...A.weekday))] : null;
  const peakHour = A.hours.some(Boolean) ? A.hours.indexOf(Math.max(...A.hours)) : null;
  const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  const sat = K.satisfaction?.v;

  return (
    <Page
      title="Wearoom"
      subtitle={`${slug} · AI virtual try-on`}
      titleMetadata={<Badge tone={planTone}>{`${plan} plan`}</Badge>}
      primaryAction={{ content: "Manage plan", onAction: goToPricing }}
      secondaryActions={[{ content: "Settings", url: "/app/settings" }, { content: "View store", onAction: openTab(`https://${shop}`) }]}
    >
      <Layout>
        {usagePercent >= 80 && (
          <Layout.Section>
            <Banner title={usagePercent >= 100 ? "Monthly limit reached — try-on is paused on your store" : "Running low on try-ons"} tone={usagePercent >= 100 ? "critical" : "warning"} action={{ content: "Upgrade plan", onAction: goToPricing }}>
              <p>{monthlyTryOns} of {monthlyLimit} try-ons used this cycle. Upgrade to keep virtual try-on active for your shoppers.</p>
            </Banner>
          </Layout.Section>
        )}

        {!badgeHidden && (
          <Layout.Section>
            <Card>
              <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center"><Text as="h2" variant="headingMd">Show try-on on product cards</Text><Badge tone="info">New</Badge></InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">Adds a "Virtual try-on" badge on collection, search and home page product cards. Shoppers tap it and land on the product with try-on open. In the theme editor, switch it on and click Save.</Text>
                </BlockStack>
                <InlineStack gap="200" wrap={false}>
                  <Button variant="primary" onClick={() => { openTab(badgeEmbedUrl)(); hideBadgeCta(); }}>Enable badge</Button>
                  <Button variant="tertiary" onClick={hideBadgeCta}>Dismiss</Button>
                </InlineStack>
              </InlineStack>
            </Card>
          </Layout.Section>
        )}

        {showOnboarding && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Setup guide</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{doneCount} of {steps.length} completed</Text>
                  </BlockStack>
                  <Button variant="plain" onClick={() => submit({ intent: "dismiss_onboarding" }, { method: "post" })}>Dismiss</Button>
                </InlineStack>
                <ProgressBar progress={(doneCount / steps.length) * 100} size="small" tone="primary" />
                <BlockStack gap="300">
                  {steps.map((s, i) => (
                    <Box key={s.key}>
                      <InlineStack align="space-between" blockAlign="center" gap="400">
                        <InlineStack gap="300" blockAlign="center">
                          <span style={{ width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: s.done ? INK : "transparent", border: s.done ? "none" : "2px solid #8a8a8a", color: "#fff", fontSize: 12 }}>{s.done ? "✓" : i + 1}</span>
                          <Text as="p" variant="bodyMd" fontWeight={s.done ? "regular" : "medium"} tone={s.done ? "subdued" : undefined} textDecorationLine={s.done ? "line-through" : undefined}>{s.label}</Text>
                        </InlineStack>
                        {!s.done && s.action}
                      </InlineStack>
                      {i < steps.length - 1 && <Box paddingBlockStart="300"><Divider /></Box>}
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ── Overview ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">Overview</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Last {range} days compared with the {range} days before{loading ? " · updating…" : ""}</Text>
                </BlockStack>
                <ButtonGroup variant="segmented">
                  {[7, 30, 90].map((r) => <Button key={r} pressed={range === r} onClick={() => setRange(r)} size="slim">{`${r} days`}</Button>)}
                </ButtonGroup>
              </InlineStack>
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
                <Kpi label="Try-ons" value={fmtN(K.tryOns?.v)} d={K.tryOns?.d} />
                <Kpi label="Add-to-cart rate" value={`${(K.atcRate?.v || 0).toFixed(1)}%`} d={K.atcRate?.d} pts />
                <Kpi label="Orders after try-on" value={fmtN(K.orders?.v)} d={K.orders?.d} />
                <Kpi label="Revenue from try-on" value={fmtMoney(currSymbol, K.revenue?.v)} d={K.revenue?.d} />
                <Kpi label="Shopper satisfaction" value={sat === null || sat === undefined ? "—" : `${sat.toFixed(0)}%`} hint={K.satisfaction?.n ? `${K.satisfaction.n} ratings (👍 / 👎)` : "No ratings yet"} />
                <Kpi label="Added to cart" value={fmtN(K.atc?.v)} d={K.atc?.d} />
                <Kpi label="Looks shared" value={fmtN(K.shares?.v)} d={K.shares?.d} />
                <Kpi label="Products tried" value={fmtN(K.productsTried?.v)} hint={`${(K.perDay?.v || 0).toFixed(1)} try-ons per day`} />
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Trend + funnel ── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Try-ons over time</Text>
                {A.series.some((x) => x.tryOns || x.atc) ? <TrendChart data={A.series} /> : <Box paddingBlock="800"><Text as="p" alignment="center" tone="subdued">Your daily try-on trend will appear here.</Text></Box>}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Shopper journey</Text>
                {[
                  { label: "Tried on", n: F.tryOns, base: F.tryOns, c: ACCENT },
                  { label: "Added to cart", n: F.atc, base: F.tryOns, c: ACCENT2 },
                  { label: "Ordered", n: F.orders, base: F.tryOns, c: "#8051E0" },
                ].map((s, i) => (
                  <BlockStack key={s.label} gap="100">
                    <InlineStack align="space-between"><Text as="span" variant="bodySm">{s.label}</Text><Text as="span" variant="bodySm" fontWeight="semibold">{fmtN(s.n)} {i > 0 && <span style={{ color: MUTED, fontWeight: 400 }}>· {s.base ? ((s.n / s.base) * 100).toFixed(1) : "0.0"}%</span>}</Text></InlineStack>
                    <div style={{ height: 28, borderRadius: 8, background: "#F3F3F3", overflow: "hidden" }}><div style={{ width: `${s.base ? Math.max(2, (s.n / s.base) * 100) : 0}%`, height: "100%", background: s.c, opacity: .85, borderRadius: 8, transition: "width .6s ease" }} /></div>
                  </BlockStack>
                ))}
                <Text as="p" variant="bodyXs" tone="subdued">Orders are counted when a shopper buys a product within 72 hours of trying it on.</Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* ── When & what ── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">By category</Text>
                {A.categories.length ? <BarList items={A.categories} /> : <Text as="p" tone="subdued" variant="bodySm">No data yet.</Text>}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between"><Text as="h2" variant="headingMd">Busiest days</Text>{peakDay && <Badge>{peakDay}</Badge>}</InlineStack>
                <Columns values={A.weekday} labels={wd.map((x) => x[0])} />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between"><Text as="h2" variant="headingMd">Busiest hours</Text>{peakHour !== null && <Badge>{hourLabel(peakHour)}</Badge>}</InlineStack>
                <Columns values={A.hours} labels={A.hours.map((_, h) => (h % 6 === 0 ? hourLabel(h) : ""))} />
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* ── Top products ── */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="400"><InlineStack align="space-between"><Text as="h2" variant="headingMd">Top products</Text><Text as="span" variant="bodySm" tone="subdued">Last {range} days</Text></InlineStack></Box>
            {A.top.length === 0 ? (
              <Box paddingBlockEnd="400">
                <EmptyState heading="No try-on data yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Product insights appear once shoppers use virtual try-on.</p>
                </EmptyState>
              </Box>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ background: "#F7F7F7", color: "#616161", textAlign: "right" }}>
                    {["Product", "Try-ons", "Added to cart", "Cart rate", "Orders", "Revenue", "👍 rating", "Last try-on"].map((h, i) => <th key={h} style={{ padding: "10px 16px", fontWeight: 600, textAlign: i === 0 ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {A.top.map((p) => {
                      const im = images[p.id];
                      const rated = p.up + p.down;
                      return (
                        <tr key={p.id} style={{ borderTop: `1px solid ${LINE}` }}>
                          <td style={{ padding: "10px 16px" }}>
                            <InlineStack gap="300" blockAlign="center" wrap={false}>
                              <Thumbnail size="small" alt={p.title} source={im?.img || "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"} />
                              <BlockStack gap="050"><Text as="span" variant="bodyMd" fontWeight="medium">{p.title}</Text>{im?.handle && <a href={`https://${shop}/products/${im.handle}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><Text as="span" variant="bodyXs" tone="subdued">View on store ↗</Text></a>}</BlockStack>
                            </InlineStack>
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>{fmtN(p.tries)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>{fmtN(p.atc)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>{p.tries ? ((p.atc / p.tries) * 100).toFixed(1) : "0.0"}%</td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>{fmtN(p.orders)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>{fmtMoney(currSymbol, p.revenue)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>{rated ? `${Math.round((p.up / rated) * 100)}% (${rated})` : "—"}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: MUTED, whiteSpace: "nowrap" }}>{p.last ? timeAgo(p.last) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Layout.Section>

        {/* ── Gallery + activity ── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050"><Text as="h2" variant="headingMd">Recent looks</Text><Text as="p" variant="bodySm" tone="subdued">What your shoppers are generating</Text></BlockStack>
                  {A.gallery.length > 0 && <Badge>{A.gallery.length}</Badge>}
                </InlineStack>
                {A.gallery.length === 0 ? (
                  <Box paddingBlock="600"><Text as="p" alignment="center" tone="subdued">Generated images will appear here once shoppers start trying on.</Text></Box>
                ) : (
                  <InlineGrid columns={{ xs: 3, sm: 4, md: 6 }} gap="300">
                    {A.gallery.map(g => (
                      <a key={g.id} href={g.resultUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                        <BlockStack gap="100">
                          <div style={{ aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", background: "#f1f1f1", border: `1px solid ${LINE}` }}>
                            <img src={g.resultUrl} alt={g.productTitle || "Try-on"} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          </div>
                          <Text as="p" variant="bodySm" truncate>{g.productTitle || "Product"}</Text>
                          <Text as="p" variant="bodyXs" tone="subdued">{timeAgo(g.createdAt)}</Text>
                        </BlockStack>
                      </a>
                    ))}
                  </InlineGrid>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between"><Text as="h2" variant="headingMd">Live activity</Text><span style={{ width: 8, height: 8, borderRadius: 9, background: "#29845A", boxShadow: "0 0 0 4px rgba(41,132,90,.15)" }} /></InlineStack>
                {A.activity.length === 0 ? <Text as="p" variant="bodySm" tone="subdued">Shopper activity will show up here in real time.</Text> : (
                  <BlockStack gap="0">
                    {A.activity.slice(0, 12).map((e, i) => {
                      const ev = EVENT[e.status] || { icon: "•", text: e.status };
                      return (
                        <Box key={i} paddingBlock="200" borderBlockEndWidth={i < Math.min(A.activity.length, 12) - 1 ? "025" : "0"} borderColor="border-secondary">
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            <div style={{ width: 30, height: 30, borderRadius: 8, background: "#F3F3F3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, overflow: "hidden" }}>
                              {e.img ? <img src={e.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : ev.icon}
                            </div>
                            <BlockStack gap="0">
                              <Text as="p" variant="bodySm">{ev.text}{e.status === "converted" && e.revenue ? ` · ${fmtMoney(currSymbol, e.revenue)}` : ""}</Text>
                              <Text as="p" variant="bodyXs" tone="subdued" truncate>{e.title} · {timeAgo(e.at)}</Text>
                            </BlockStack>
                          </InlineStack>
                        </Box>
                      );
                    })}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* ── Plan & usage ── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center"><Text as="h2" variant="headingMd">Plan & usage</Text><Badge tone={planTone}>{plan}</Badge></InlineStack>
                <Button variant="plain" onClick={goToPricing}>Change plan</Button>
              </InlineStack>
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Used this cycle</Text><Text as="p" variant="headingLg">{fmtN(monthlyTryOns)}</Text></BlockStack>
                <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Remaining</Text><Text as="p" variant="headingLg">{fmtN(creditsLeft)}</Text></BlockStack>
                <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Projected this cycle</Text><Text as="p" variant="headingLg" tone={projected > monthlyLimit ? "critical" : undefined}>{fmtN(projected)}</Text></BlockStack>
                <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Resets in</Text><Text as="p" variant="headingLg">{daysLeft} days</Text></BlockStack>
              </InlineGrid>
              <BlockStack gap="200">
                <ProgressBar progress={usagePercent} tone={usageTone} size="small" />
                <Text as="p" variant="bodySm" tone={willRunOut ? "critical" : "subdued"}>
                  {monthlyTryOns} of {monthlyLimit} used · {willRunOut ? `at the current pace you'll run out in about ${daysToLimit} day${daysToLimit === 1 ? "" : "s"} — before the reset` : pace > 0 ? `on track — about ${pace.toFixed(1)} try-ons a day` : "resets every 30 days"}
                </Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Plans</Text>
                <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="200">
                  {[
                    { key: "free", name: "Free", price: "$0", tries: 10 },
                    { key: "starter", name: "Starter", price: "$15.99", tries: 100 },
                    { key: "growth", name: "Growth", price: "$59.99", tries: 300 },
                    { key: "pro", name: "Pro", price: "$119.99", tries: 700 },
                    { key: "business", name: "Business", price: "$249.99", tries: 1500 },
                    { key: "enterprise", name: "Enterprise", price: "$479.99", tries: 3000 },
                  ].map((p, idx, all) => {
                    const current = plan.toLowerCase() === p.key;
                    const bestFit = projected > monthlyLimit ? all.find((q) => q.tries >= projected) : null;
                    const fits = !current && bestFit && bestFit.key === p.key;
                    return (
                      <div key={p.key} onClick={current ? undefined : goToPricing} style={{ cursor: current ? "default" : "pointer", borderRadius: 10, padding: 12, border: current ? `2px solid ${INK}` : `1px solid ${fits ? "#29845A" : "#E3E3E3"}`, background: current ? "#F7F7F7" : "#FFFFFF" }}>
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" variant="bodySm" fontWeight="semibold">{p.name}</Text>
                            {current ? <Badge tone="success" size="small">Current</Badge> : fits ? <Badge tone="success" size="small">Recommended</Badge> : null}
                          </InlineStack>
                          <Text as="p" variant="headingMd">{p.tries.toLocaleString()}</Text>
                          <Text as="p" variant="bodyXs" tone="subdued">try-ons / month · {p.price}</Text>
                        </BlockStack>
                      </div>
                    );
                  })}
                </InlineGrid>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Side info ── */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Store health</Text>
                {[
                  ["Try-on button on product page", onboarding.themeBlockAdded],
                  ["Plan active", onboarding.planChosen],
                  ["Try-ons available", creditsLeft > 0],
                ].map(([l, ok]) => (
                  <InlineStack key={l} align="space-between" blockAlign="center"><Text as="span" variant="bodySm">{l}</Text><Badge tone={ok ? "success" : "critical"} size="small">{ok ? "OK" : "Action needed"}</Badge></InlineStack>
                ))}
                <InlineStack align="space-between" blockAlign="center"><Text as="span" variant="bodySm">Badge on product cards</Text><Button variant="plain" onClick={openTab(badgeEmbedUrl)}>Check</Button></InlineStack>
                <Divider />
                <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">All-time try-ons</Text><Text as="span" variant="bodySm" fontWeight="semibold">{fmtN(allTimeTryOns)}</Text></InlineStack>
                <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Products in store</Text><Text as="span" variant="bodySm" fontWeight="semibold">{fmtN(totalProducts)}</Text></InlineStack>
                <Button url="/app/settings" fullWidth>Button style & per-product control</Button>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Need help?</Text>
                <Text as="p" variant="bodySm" tone="subdued">Setup help, an issue, or a custom plan for higher volume — we usually reply within a few hours.</Text>
                <a href={`https://wa.me/917002073054?text=${encodeURIComponent(`Hi, I need help with Wearoom (${shop})`)}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: "#25D366", color: "#fff", textDecoration: "none" }}>
                  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path fill="#fff" d="M16.04 3C9.4 3 4 8.36 4 14.96c0 2.3.66 4.45 1.8 6.27L4 29l7.98-1.76a12.1 12.1 0 0 0 4.06.7C22.68 27.94 28 22.58 28 15.98 28 9.38 22.68 3 16.04 3zm0 22.73c-1.3 0-2.58-.24-3.78-.7l-.54-.21-4.73 1.04 1.06-4.53-.25-.48a9.7 9.7 0 0 1-1.47-5.1c0-5.37 4.4-9.74 9.8-9.74 5.38 0 9.75 4.6 9.75 9.97 0 5.37-4.37 9.75-9.84 9.75z"/>
                    <path fill="#fff" d="M21.5 18.4c-.3-.15-1.76-.86-2.03-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.78-1.49-1.75-1.66-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.6-.92-2.2-.24-.57-.49-.5-.67-.5h-.57c-.2 0-.52.08-.8.37-.27.3-1.04 1.01-1.04 2.47 0 1.45 1.07 2.86 1.22 3.06.15.2 2.1 3.2 5.08 4.48.71.31 1.27.49 1.7.63.72.22 1.37.19 1.88.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.27-.2-.57-.35z"/>
                  </svg>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <span style={{ fontWeight: 650, fontSize: 14 }}>Chat on WhatsApp</span>
                    <span style={{ fontSize: 13, opacity: 0.92 }}>+91 70020 73054</span>
                  </span>
                </a>
                <a href={`mailto:support@futuretechiez.in?subject=${encodeURIComponent(`Wearoom support — ${shop}`)}`}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid #E3E3E3", color: INK, textDecoration: "none" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>
                  </svg>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <span style={{ fontWeight: 650, fontSize: 14 }}>Email support</span>
                    <span style={{ fontSize: 13, color: "#616161" }}>support@futuretechiez.in</span>
                  </span>
                </a>
                <Text as="p" variant="bodyXs" tone="subdued">Need more than 3,000 try-ons a month? Message us for a custom plan.</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Latest products</Text>
                {products.length === 0 ? <Text as="p" variant="bodySm" tone="subdued">No products found.</Text> : (
                  <BlockStack gap="300">
                    {products.slice(0, 4).map((p) => (
                      <InlineStack key={p.id} gap="300" blockAlign="center" wrap={false}>
                        <Thumbnail source={p.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"} alt={p.title} size="small" />
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" fontWeight="medium" truncate>{p.title}</Text>
                          <Text as="p" variant="bodyXs" tone="subdued">{p.priceRangeV2?.minVariantPrice ? `${p.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(p.priceRangeV2.minVariantPrice.amount).toFixed(0)}` : "—"}</Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>
      </Layout>
      <Box paddingBlockStart="800" paddingBlockEnd="400">
        <InlineStack align="center">
          <Text as="p" variant="bodySm" tone="subdued">Wearoom by <a href="https://futuretechiez.in" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>FutureTechiez</a></Text>
        </InlineStack>
      </Box>
    </Page>
  );
}
