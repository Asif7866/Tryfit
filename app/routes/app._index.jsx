import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, InlineGrid, Box,
  Badge, Button, ProgressBar, Divider, Thumbnail, EmptyState, Banner,
  DataTable, Link as PolarisLink, Checkbox,
} from "@shopify/polaris";
import shopify, { prisma } from "../shopify.server";
import { ensureMonthlyReset } from "../lib/usage.server";

const APP_HANDLE = "tryfit-5";
const THEME_EXT_UID = "83bb5402-d1c3-404c-b6bf-94b8bc49f12e65c66f66";
const PLAN_LIMITS = { free: 5, starter: 100, growth: 300, pro: 700 };
const THIRTY_DAYS_AGO = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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
        return json({ requiresPlan: true, pricingUrl: `https://admin.shopify.com/store/${shopSlug}/charges/${APP_HANDLE}/pricing_plans`, shop });
      }
    }

    const activePlan = activeSubs.find(s => s.status === "ACTIVE");
    const planName = activePlan?.name || "Free";
    const planKey = planName.toLowerCase();
    const monthlyLimit = PLAN_LIMITS[planKey] || 5;

    // 2. Merchant email (for usage alerts) + products
    let merchantEmail = null;
    const [shopRes, prodRes] = await Promise.all([
      admin.graphql(`{ shop { email } }`),
      admin.graphql(`{
        products(first: 6, sortKey: UPDATED_AT, reverse: true) {
          edges { node { id title status featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } } } }
        }
        productsCount { count }
      }`),
    ]);
    try { merchantEmail = (await shopRes.json()).data?.shop?.email || null; } catch (e) {}
    const prodData = await prodRes.json();
    const products = (prodData.data?.products?.edges || []).map(e => e.node);
    const totalProducts = prodData.data?.productsCount?.count || products.length;
    const currencyCode = products[0]?.priceRangeV2?.minVariantPrice?.currencyCode || "INR";

    // 3. Sync plan + email, lazy monthly reset
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { plan: planKey, monthlyLimit, enabled: true, ...(merchantEmail ? { merchantEmail } : {}) },
      create: { shop, plan: planKey, monthlyLimit, enabled: true, merchantEmail, lastResetAt: new Date() },
    });
    const settings = await ensureMonthlyReset(shop);

    // 4. Analytics (30d)
    const since = THIRTY_DAYS_AGO();
    const [totalTryOns, addToCartCount, converted, logs, gallery] = await Promise.all([
      prisma.tryOnLog.count({ where: { shop, status: "completed", createdAt: { gte: since } } }),
      prisma.tryOnLog.count({ where: { shop, status: "added_to_cart", createdAt: { gte: since } } }),
      prisma.tryOnLog.findMany({ where: { shop, status: "converted", createdAt: { gte: since } }, select: { revenue: true } }),
      prisma.tryOnLog.findMany({ where: { shop, createdAt: { gte: since }, status: { in: ["completed", "added_to_cart"] } }, orderBy: { createdAt: "desc" }, take: 1000, select: { productId: true, productTitle: true, status: true } }),
      prisma.tryOnLog.findMany({
        where: { shop, status: "completed", resultUrl: { not: "" }, NOT: { resultUrl: "client-fallback" } },
        orderBy: { createdAt: "desc" }, take: 12,
        select: { id: true, resultUrl: true, productTitle: true, createdAt: true },
      }),
    ]);
    const tryOnRevenue = converted.reduce((s, c) => s + (c.revenue || 0), 0);
    const conversions = converted.length;
    const uniqueUsers = new Set(logs.filter(l => l.status === "completed").map(l => l.productId)).size;
    const counts = {};
    logs.forEach(l => {
      if (!counts[l.productId]) counts[l.productId] = { id: l.productId, title: l.productTitle || "Unknown", count: 0, atc: 0 };
      if (l.status === "completed") counts[l.productId].count++;
      if (l.status === "added_to_cart") counts[l.productId].atc++;
    });
    const topProducts = Object.values(counts).filter(c => c.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
    const addToCartRate = totalTryOns > 0 ? ((addToCartCount / totalTryOns) * 100).toFixed(1) : "0.0";
    const allTimeTryOns = settings?.totalTryOns || 0;

    return json({
      shop, products, totalProducts, currencyCode,
      monthlyTryOns: settings?.monthlyTryOns || 0, monthlyLimit, plan: planName,
      totalTryOns, uniqueUsers, topProducts, addToCartRate, tryOnRevenue: tryOnRevenue.toFixed(2), conversions,
      gallery, allTimeTryOns,
      onboarding: {
        planChosen: hasPaidPlan || hasChosenPlan,
        themeBlockAdded: settings?.themeBlockAdded || false,
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
      monthlyTryOns: 0, monthlyLimit: 5, plan: "Free", totalTryOns: 0, uniqueUsers: 0, topProducts: [],
      addToCartRate: "0.0", tryOnRevenue: "0.00", conversions: 0, gallery: [], allTimeTryOns: 0,
      onboarding: { planChosen: true, themeBlockAdded: true, tested: true, dismissed: true }, fallback: true,
    };
    try {
      if (shopName) {
        const settings = await prisma.shopSettings.findUnique({ where: { shop: shopName } });
        const since = THIRTY_DAYS_AGO();
        const totalTryOns = await prisma.tryOnLog.count({ where: { shop: shopName, status: "completed", createdAt: { gte: since } } });
        const gallery = await prisma.tryOnLog.findMany({
          where: { shop: shopName, status: "completed", resultUrl: { not: "" }, NOT: { resultUrl: "client-fallback" } },
          orderBy: { createdAt: "desc" }, take: 12, select: { id: true, resultUrl: true, productTitle: true, createdAt: true },
        });
        fb = { ...fb, shop: shopName, monthlyTryOns: settings?.monthlyTryOns || 0, monthlyLimit: settings?.monthlyLimit || 5, plan: settings?.plan || "Free", totalTryOns, gallery, allTimeTryOns: settings?.totalTryOns || 0 };
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

export default function Index() {
  const d = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();

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

  const { shop, products, totalProducts, currencyCode, monthlyTryOns, monthlyLimit, plan, totalTryOns, uniqueUsers, topProducts, addToCartRate, tryOnRevenue, conversions, gallery, onboarding } = d;
  const slug = shop.replace(".myshopify.com", "");
  const usagePercent = monthlyLimit > 0 ? Math.min((monthlyTryOns / monthlyLimit) * 100, 100) : 0;
  const creditsLeft = Math.max(monthlyLimit - monthlyTryOns, 0);
  const currSymbol = { USD: "$", EUR: "€", GBP: "£", INR: "₹", AED: "AED " }[currencyCode] || `${currencyCode} `;
  const goToPricing = () => {
    if (window.shopify?.navigate) window.shopify.navigate(`/charges/${APP_HANDLE}/pricing_plans`);
    else window.top.location.href = `https://admin.shopify.com/store/${slug}/charges/${APP_HANDLE}/pricing_plans`;
  };
  const themeEditorUrl = `https://admin.shopify.com/store/${slug}/themes/current/editor?template=product&addAppBlockId=${THEME_EXT_UID}/try-on&target=mainSection`;
  const planTone = plan.toLowerCase() === "free" ? "info" : plan.toLowerCase() === "pro" ? "success" : "attention";
  const usageTone = usagePercent >= 90 ? "critical" : usagePercent >= 70 ? "warning" : "success";

  const steps = [
    { key: "plan", label: "Choose a plan", done: onboarding.planChosen, action: <Button size="slim" onClick={goToPricing}>View plans</Button> },
    { key: "theme", label: "Add the try-on button to your product page", done: onboarding.themeBlockAdded,
      action: <InlineStack gap="200"><Button size="slim" url={themeEditorUrl} external>Open theme editor</Button>
        <Checkbox label="Done" checked={onboarding.themeBlockAdded} onChange={(v) => submit({ intent: "theme_added", value: v ? "1" : "0" }, { method: "post" })} /></InlineStack> },
    { key: "test", label: "Run a test try-on on your storefront", done: onboarding.tested,
      action: <Button size="slim" url={`https://${shop}`} external>Open store</Button> },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const showOnboarding = !onboarding.dismissed && doneCount < steps.length;

  const productRows = topProducts.map(p => [p.title, p.count, `${p.count > 0 ? ((p.atc / p.count) * 100).toFixed(1) : "0.0"}%`]);

  return (
    <Page
      title="TryFit"
      subtitle={shop}
      primaryAction={{ content: "Manage plan", onAction: goToPricing }}
      secondaryActions={[{ content: "Settings", url: "/app/settings" }]}
    >
      <Layout>
        {usagePercent >= 80 && (
          <Layout.Section>
            <Banner title={usagePercent >= 100 ? "Monthly limit reached" : "Running low on try-ons"} tone={usagePercent >= 100 ? "critical" : "warning"} action={{ content: "Upgrade plan", onAction: goToPricing }}>
              <p>{monthlyTryOns} of {monthlyLimit} try-ons used this cycle. Upgrade to keep virtual try-on active for your shoppers.</p>
            </Banner>
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
                          <span style={{ width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: s.done ? "#303030" : "transparent", border: s.done ? "none" : "2px solid #8a8a8a", color: "#fff", fontSize: 12 }}>{s.done ? "✓" : i + 1}</span>
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

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Performance</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Last 30 days</Text>
                </BlockStack>
                <Badge tone="success">Active</Badge>
              </InlineStack>
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                {[
                  { label: "Try-ons", value: totalTryOns.toLocaleString() },
                  { label: "Add-to-cart rate", value: `${addToCartRate}%` },
                  { label: "Orders from try-on", value: conversions.toLocaleString() },
                  { label: "Try-on revenue", value: `${currSymbol}${Number(tryOnRevenue).toLocaleString()}` },
                ].map((s, i) => (
                  <Box key={i} padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                      <Text as="p" variant="headingLg">{s.value}</Text>
                    </BlockStack>
                  </Box>
                ))}
              </InlineGrid>
              <Text as="p" variant="bodySm" tone="subdued">Revenue is attributed when a shopper orders a product within 72 hours of trying it on.</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Plan & usage</Text>
                  <Badge tone={planTone}>{plan}</Badge>
                </InlineStack>
                <Button variant="plain" onClick={goToPricing}>Change plan</Button>
              </InlineStack>
              <InlineGrid columns={3} gap="400">
                <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Used this cycle</Text><Text as="p" variant="headingLg">{monthlyTryOns}</Text></BlockStack>
                <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Remaining</Text><Text as="p" variant="headingLg">{creditsLeft}</Text></BlockStack>
                <BlockStack gap="100"><Text as="p" variant="bodySm" tone="subdued">Monthly limit</Text><Text as="p" variant="headingLg">{monthlyLimit}</Text></BlockStack>
              </InlineGrid>
              <BlockStack gap="200">
                <ProgressBar progress={usagePercent} tone={usageTone} size="small" />
                <Text as="p" variant="bodySm" tone="subdued">{monthlyTryOns} of {monthlyLimit} used · resets every 30 days</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Recent try-ons</Text>
                  <Text as="p" variant="bodySm" tone="subdued">What your shoppers are generating</Text>
                </BlockStack>
                {gallery.length > 0 && <Badge>{gallery.length}</Badge>}
              </InlineStack>
              {gallery.length === 0 ? (
                <Box paddingBlock="400"><InlineStack align="center"><Text as="p" tone="subdued">Generated images will appear here once shoppers start trying on.</Text></InlineStack></Box>
              ) : (
                <InlineGrid columns={{ xs: 3, sm: 4, md: 6 }} gap="300">
                  {gallery.map(g => (
                    <a key={g.id} href={g.resultUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                      <BlockStack gap="100">
                        <div style={{ aspectRatio: "3/4", borderRadius: 8, overflow: "hidden", background: "#f1f1f1", border: "1px solid #e3e3e3" }}>
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
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="400"><Text as="h2" variant="headingMd">Top products by try-on</Text></Box>
            {topProducts.length === 0 ? (
              <Box paddingBlockEnd="400">
                <EmptyState heading="No try-on data yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Analytics will appear once shoppers use virtual try-on on your product pages.</p>
                </EmptyState>
              </Box>
            ) : (
              <DataTable columnContentTypes={["text", "numeric", "numeric"]} headings={["Product", "Try-ons", "Add-to-cart rate"]} rows={productRows} />
            )}
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Products</Text>
                  <Badge>{totalProducts}</Badge>
                </InlineStack>
                {products.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">No products found in your store.</Text>
                ) : (
                  <BlockStack gap="300">
                    {products.slice(0, 5).map((p, i) => (
                      <BlockStack key={p.id} gap="300">
                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                          <Thumbnail source={p.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"} alt={p.title} size="small" />
                          <BlockStack gap="050">
                            <Text as="p" variant="bodyMd" fontWeight="medium" truncate>{p.title}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">{p.priceRangeV2?.minVariantPrice ? `${p.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(p.priceRangeV2.minVariantPrice.amount).toFixed(0)}` : "—"}</Text>
                          </BlockStack>
                        </InlineStack>
                        {i < Math.min(products.length, 5) - 1 && <Divider />}
                      </BlockStack>
                    ))}
                  </BlockStack>
                )}
                <Button url="/app/settings" fullWidth>Manage try-on per product</Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Need help?</Text>
                <Text as="p" variant="bodyMd" tone="subdued">Get setup assistance or report an issue. We usually respond within a few hours.</Text>
                <Button url="https://wa.me/917002073054?text=Hi%20need%20help%20with%20TryFit" external fullWidth>Contact support</Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Store details</Text>
                <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Shop</Text><Text as="span" variant="bodySm">{slug}</Text></InlineStack>
                <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Unique shoppers (30d)</Text><Text as="span" variant="bodySm">{uniqueUsers}</Text></InlineStack>
                <InlineStack align="space-between"><Text as="span" variant="bodySm" tone="subdued">Extension</Text><Badge tone={onboarding.themeBlockAdded ? "success" : "attention"} size="small">{onboarding.themeBlockAdded ? "Installed" : "Not added"}</Badge></InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
      <Box paddingBlockStart="800" paddingBlockEnd="400">
        <InlineStack align="center">
          <Text as="p" variant="bodySm" tone="subdued">Powered by <PolarisLink url="https://futuretechiez.in" external removeUnderline>FutureTechiez</PolarisLink></Text>
        </InlineStack>
      </Box>
    </Page>
  );
}
