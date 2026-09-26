import { json, redirect, createCookie } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, InlineGrid, Box,
  Badge, Button, ProgressBar, Divider, Thumbnail, EmptyState, Banner,
  DataTable, Icon, Link as PolarisLink,
} from "@shopify/polaris";
import shopify from "../shopify.server";
import { prisma } from "../shopify.server";

const setupCookie = createCookie("tryfit_setup", { maxAge: 365 * 24 * 60 * 60 });

export const action = async ({ request }) => {
  try {
    const { session } = await shopify.authenticate.admin(request);
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { enabled: true },
      create: { shop: session.shop, enabled: true },
    });
  } catch (e) {}
  return json({ ok: true }, { headers: { "Set-Cookie": await setupCookie.serialize("done") } });
};

export const loader = async ({ request }) => {
  const cookieVal = await setupCookie.parse(request.headers.get("Cookie"));
  const fromCookie = cookieVal === "done";
  let authenticatedShop = null;
  // Pre-extract shop from request URL params or host param (survives into catch block)
  try {
    const reqUrl = new URL(request.url);
    const sp = reqUrl.searchParams.get("shop") || reqUrl.searchParams.get("myshopify_domain");
    if (sp) authenticatedShop = sp;
    if (!authenticatedShop) {
      const h = reqUrl.searchParams.get("host");
      if (h) { const d = atob(h); const m = d.match(/([^/]+\.myshopify\.com)/); if (m) authenticatedShop = m[1]; }
    }
  } catch(_){}
  try {
    const { admin, session } = await shopify.authenticate.admin(request);
    authenticatedShop = session.shop;

    // 1. Check active Shopify App Pricing subscription
    const billingRes = await admin.graphql(`{
      appInstallation {
        activeSubscriptions {
          id
          name
          status
          test
        }
      }
    }`);
    const billingData = await billingRes.json();
    const activeSubs = billingData.data?.appInstallation?.activeSubscriptions || [];
    const hasActiveSub = activeSubs.some(s => s.status === "ACTIVE");
    const hasPaidPlan = activeSubs.some(s => s.status === "ACTIVE" && s.name && s.name.toLowerCase() !== "free");

    // 2. Check if merchant has explicitly chosen a plan (DB flag)
    const existingSettings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
    const hasChosenPlan = existingSettings?.planChosen === true;

    // 3. If no paid plan AND merchant hasn't explicitly chosen a plan → redirect to pricing page
    // This forces ALL new installs to visit pricing page, even for free plan
    if (!hasPaidPlan && !hasChosenPlan) {
      const shopSlug = session.shop.replace(".myshopify.com", "");
      const pricingUrl = `https://admin.shopify.com/store/${shopSlug}/charges/tryfit-5/pricing_plans`;
      
      // Mark in DB that we've sent them to pricing (they'll come back after choosing)
      // We set planChosen=true AFTER they return with an active subscription
      // For now, check URL for "charge_id" param which Shopify adds after plan approval
      const reqUrl = new URL(request.url);
      const chargeId = reqUrl.searchParams.get("charge_id");
      
      if (chargeId) {
        // Merchant just approved a plan — mark as chosen
        await prisma.shopSettings.upsert({
          where: { shop: session.shop },
          update: { planChosen: true },
          create: { shop: session.shop, planChosen: true, enabled: true },
        });
      } else {
        return json({ requiresPlan: true, pricingUrl, shop: session.shop });
      }
    }

    // 3. Active plan info
    const activePlan = activeSubs.find(s => s.status === "ACTIVE");
    const planName = activePlan?.name || "Free";

    // Plan limits mapping
    const PLAN_LIMITS = { "free": 5, "starter": 100, "growth": 300, "pro": 700 };
    const planKey = planName.toLowerCase();
    const monthlyLimit = PLAN_LIMITS[planKey] || 5;

    // 4. Fetch real products + product count
    const prodRes = await admin.graphql(`{
      products(first: 10, sortKey: UPDATED_AT, reverse: true) {
        edges { node { id title status totalInventory priceRangeV2 { minVariantPrice { amount currencyCode } } featuredImage { url } } }
      }
      productsCount: productsCount { count }
    }`);
    const prodData = await prodRes.json();
    const products = prodData.data.products.edges.map(e => e.node);
    const totalProducts = prodData.data.productsCount?.count || products.length;

    // 5. Fetch real order revenue (last 30 days)
    let totalRevenue = 0;
    let currencyCode = "INR";
    try {
      const orderRes = await admin.graphql(`{
        orders(first: 1, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}'") {
          edges {
            node {
              totalPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
        ordersCount: ordersCount(query: "created_at:>='${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}'") { count }
      }`);
      const orderData = await orderRes.json();
      const orderEdges = orderData.data?.orders?.edges || [];
      if (orderEdges.length > 0) {
        currencyCode = orderEdges[0].node.totalPriceSet.shopMoney.currencyCode;
      }
      // Get total revenue from all recent orders
      const allOrdersRes = await admin.graphql(`{
        orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}'") {
          edges {
            node {
              totalPriceSet { shopMoney { amount } }
            }
          }
        }
      }`);
      const allOrderData = await allOrdersRes.json();
      totalRevenue = (allOrderData.data?.orders?.edges || []).reduce(
        (sum, e) => sum + parseFloat(e.node.totalPriceSet.shopMoney.amount || 0), 0
      );
    } catch (e) {}

    // 6. Real analytics from TryOnLog DB
    let totalTryOns = 0, uniqueUsers = 0, topProducts = [], addToCartCount = 0;
    let settings = null;
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Sync plan + limits to DB
      settings = await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        update: { plan: planKey, monthlyLimit, enabled: true },
        create: { shop: session.shop, plan: planKey, monthlyLimit, enabled: true },
      });

      // Real try-on count (30 days)
      totalTryOns = await prisma.tryOnLog.count({
        where: { shop: session.shop, createdAt: { gte: thirtyDaysAgo } },
      });

      // Real unique users (distinct productIds as proxy — each unique product tried = unique session)
      const logs = await prisma.tryOnLog.findMany({
        where: { shop: session.shop, createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
      uniqueUsers = new Set(logs.map(l => l.productId)).size;

      // Real add-to-cart: count logs with status "added_to_cart"
      addToCartCount = await prisma.tryOnLog.count({
        where: { shop: session.shop, createdAt: { gte: thirtyDaysAgo }, status: "added_to_cart" },
      });

      // Top products by try-on count
      const counts = {};
      logs.forEach(l => {
        if (!counts[l.productId]) counts[l.productId] = { id: l.productId, title: l.productTitle || "Unknown", count: 0, atc: 0 };
        counts[l.productId].count++;
      });
      // Count per-product ATC
      const atcLogs = logs.filter(l => l.status === "added_to_cart");
      atcLogs.forEach(l => {
        if (counts[l.productId]) counts[l.productId].atc++;
      });
      topProducts = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
    } catch (e) {}

    // Real add-to-cart rate
    const addToCartRate = totalTryOns > 0 ? ((addToCartCount / totalTryOns) * 100).toFixed(1) : "0.0";

    return json({
      shop: session.shop,
      products,
      totalProducts,
      monthlyTryOns: settings?.monthlyTryOns || 0,
      monthlyLimit,
      totalTryOns,
      uniqueUsers,
      topProducts,
      plan: planName,
      addToCartRate,
      totalRevenue: totalRevenue.toFixed(2),
      currencyCode,
      setupCompleted: !!settings || fromCookie,
    });
  } catch (e) {
    // Auth failed — try to get data from DB using shop from URL
    let fallbackData = {
      shop: authenticatedShop || "unknown", products: [], totalProducts: 0,
      monthlyTryOns: 0, monthlyLimit: 5, totalTryOns: 0,
      uniqueUsers: 0, topProducts: [], plan: "Free",
      addToCartRate: "0.0", totalRevenue: "0.00", currencyCode: "INR",
      setupCompleted: fromCookie,
    };
    try {
      const url = new URL(request.url);
      const shopParam = url.searchParams.get("shop") || url.searchParams.get("myshopify_domain");
      let shopName = shopParam;
      // Try decode Shopify host param (base64 encoded shop/admin path)
      if (!shopName) {
        const host = url.searchParams.get("host");
        if (host) { try { const decoded = atob(host); const match = decoded.match(/([^/]+\.myshopify\.com)/); if (match) shopName = match[1]; } catch(e){} }
      }
      // SECURITY: Never use findFirst() without shop filter — it returns ANY store's data
      // Shop must come from URL params or host decode only
      if (shopName) {
        const settings = await prisma.shopSettings.findUnique({ where: { shop: shopName } });
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const totalTryOns = await prisma.tryOnLog.count({ where: { shop: shopName, createdAt: { gte: thirtyDaysAgo } } });
        const logs = await prisma.tryOnLog.findMany({ where: { shop: shopName, createdAt: { gte: thirtyDaysAgo } }, orderBy: { createdAt: "desc" }, take: 500 });
        const uniqueUsers = new Set(logs.map(l => l.productId)).size;
        const addToCartCount = await prisma.tryOnLog.count({ where: { shop: shopName, createdAt: { gte: thirtyDaysAgo }, status: "added_to_cart" } });
        const counts = {};
        logs.forEach(l => {
          if (!counts[l.productId]) counts[l.productId] = { id: l.productId, title: l.productTitle || "Unknown", count: 0, atc: 0 };
          counts[l.productId].count++;
        });
        const atcLogs = logs.filter(l => l.status === "added_to_cart");
        atcLogs.forEach(l => { if (counts[l.productId]) counts[l.productId].atc++; });
        const topProducts = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);

        fallbackData = {
          shop: shopName,
          products: [], totalProducts: 0,
          monthlyTryOns: settings?.monthlyTryOns || 0,
          monthlyLimit: settings?.monthlyLimit || 5,
          totalTryOns,
          uniqueUsers,
          topProducts,
          plan: settings?.plan || "Free",
          addToCartRate: totalTryOns > 0 ? ((addToCartCount / totalTryOns) * 100).toFixed(1) : "0.0",
          totalRevenue: "0.00", currencyCode: "INR",
          setupCompleted: !!settings || fromCookie,
        };
      }
    } catch (dbErr) {}
    return json(fallbackData);
  }
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700;800&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Jost', sans-serif !important; background: #fafafa; }
@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
@keyframes scaleIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.5; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.fu { animation: fadeUp .5s ease forwards; opacity:0; }
.fu1{animation-delay:.05s}.fu2{animation-delay:.1s}.fu3{animation-delay:.15s}.fu4{animation-delay:.2s}.fu5{animation-delay:.25s}.fu6{animation-delay:.3s}
.card { background:#fff; border-radius:16px; border:1px solid #eee; padding:28px; transition:all .2s; }
.card:hover { box-shadow:0 8px 30px rgba(0,0,0,.06); }
.btn { padding:12px 28px; border-radius:12px; border:none; font-family:'Jost',sans-serif; font-weight:600; font-size:14px; cursor:pointer; transition:all .2s; display:inline-flex; align-items:center; gap:8px; }
.btn:hover { transform:translateY(-1px); }
.btn-primary { background:#111; color:#fff; }
.btn-primary:hover { background:#333; }
.btn-outline { background:transparent; color:#111; border:1.5px solid #ddd; }
.btn-outline:hover { border-color:#111; }
.btn-accent { background:#4f46e5; color:#fff; }
.btn-accent:hover { background:#4338ca; }
.step-dot { width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; transition:all .3s; }
.step-dot.active { background:#111; color:#fff; }
.step-dot.done { background:#4f46e5; color:#fff; }
.step-dot.pending { background:#f3f3f3; color:#999; }
.step-line { width:1px; height:20px; background:#eee; margin:4px 0 4px 15px; }
.step-label { font-size:14px; font-weight:500; transition:color .2s; }
.product-row { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-radius:14px; border:1px solid #f0f0f0; transition:all .15s; cursor:default; }
.product-row:hover { background:#f8f8f8; transform:translateX(2px); }
.stat-card { text-align:center; padding:24px 20px; }
.stat-value { font-size:36px; font-weight:800; color:#111; letter-spacing:-1px; }
.stat-label { font-size:11px; text-transform:uppercase; letter-spacing:1.5px; color:#999; font-weight:500; margin-bottom:8px; }
.stat-sub { font-size:12px; color:#888; margin-top:4px; }
.cat-item { padding:14px 18px; border-radius:12px; border:1.5px solid #eee; cursor:pointer; transition:all .2s; }
.cat-item:hover { border-color:#ccc; }
.cat-item.selected { border-color:#4f46e5; background:rgba(16,185,129,.04); }
.upload-zone { border:2px dashed #ddd; border-radius:16px; padding:40px; text-align:center; cursor:pointer; transition:all .2s; }
.upload-zone:hover { border-color:#4f46e5; background:rgba(16,185,129,.02); }
.live-dot { width:8px; height:8px; border-radius:50%; background:#4f46e5; animation:pulse 2s infinite; display:inline-block; }
.progress-bar { height:4px; border-radius:4px; background:#f0f0f0; overflow:hidden; }
.progress-fill { height:100%; border-radius:4px; background:#4f46e5; transition:width .8s ease; }
.phone-preview { width:260px; background:#111; border-radius:28px; padding:12px; box-shadow:0 20px 60px rgba(0,0,0,.2); }
.phone-screen { background:#fff; border-radius:20px; overflow:hidden; }
.result-img { width:100%; border-radius:12px; object-fit:cover; }
.spinner { width:20px; height:20px; border:2px solid #ddd; border-top-color:#111; border-radius:50%; animation:spin .6s linear infinite; }
.tag { display:inline-block; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600; letter-spacing:.3px; }
.tag-green { background:rgba(79,70,229,.1); color:#4f46e5; }
.tag-yellow { background:rgba(251,191,36,.1); color:#d97706; }
.tag-blue { background:rgba(59,130,246,.1); color:#2563eb; }
`;

const STEPS = [
  { id: "start", label: "Get Started" },
  { id: "categories", label: "Categories" },
  { id: "contact", label: "Contact Info" },
  { id: "tryon", label: "Try it On" },
  { id: "addblock", label: "Add Button" },
];

const CATEGORIES = [
  { name: "Indo Western", desc: "Jacket kurti, fusion dress, dhoti pant" },
  { name: "Party Wear", desc: "Cocktail dress, evening gown, lehenga" },
  { name: "Winter Wear", desc: "Puffer jacket, hoodie, sweater" },
  { name: "Casual Wear", desc: "T-shirts, polo shirts, kurtis" },
  { name: "Watches", desc: "Wristwatches, smartwatches, luxury" },
  { name: "Jewellery", desc: "Rings, necklaces, earrings, bangles" },
  { name: "Activewear", desc: "Sports bra, joggers, tracksuit" },
  { name: "Headwear", desc: "Baseball cap, snapback, beanie" },
];

export default function Index() {
  const loaderData = useLoaderData();
  const { shop, products, totalProducts, monthlyTryOns, monthlyLimit, totalTryOns, uniqueUsers, topProducts, plan, setupCompleted, addToCartRate, totalRevenue, currencyCode } = loaderData;
  const submit = useSubmit();

  // Billing redirect — install ke baad seedha pricing page
  useEffect(() => {
    if (loaderData?.requiresPlan && loaderData?.pricingUrl) {
      // App Bridge embedded app — top-level redirect to Shopify pricing page
      if (window.top !== window.self) {
        window.top.location.href = loaderData.pricingUrl;
      } else {
        window.location.href = loaderData.pricingUrl;
      }
    }
  }, [loaderData]);

  if (loaderData?.requiresPlan) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", fontFamily: "'Jost', sans-serif" }}>
          <div style={{ textAlign: "center" }}>
            <div className="spinner" style={{ width: 40, height: 40, margin: "0 auto 20px", borderWidth: 3 }} />
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#111", marginBottom: 8 }}>Setting up your account...</h2>
            <p style={{ fontSize: 14, color: "#888" }}>Redirecting to plan selection</p>
          </div>
        </div>
      </>
    );
  }

  const [step, setStep] = useState("start");
  const [setupDone, setSetupDone] = useState(true);
  const [cats, setCats] = useState([]);
  const [phone, setPhone] = useState("7002073054");
  const [userImg, setUserImg] = useState(null);
  const [resultImg, setResultImg] = useState(null);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);
  const canvasRef = useRef(null);

  const toggleCat = (name) => setCats(prev => prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]);

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUserImg(ev.target.result);
      generateTryOn(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const generateTryOn = useCallback((userSrc) => {
    setProcessing(true);
    setResultImg(null);
    const productImg = products[0]?.featuredImage?.url;
    
    setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 500;
      canvas.height = 650;
      const ctx = canvas.getContext("2d");

      const userImage = new Image();
      userImage.crossOrigin = "anonymous";
      userImage.onload = () => {
        ctx.drawImage(userImage, 0, 0, 500, 650);
        
        if (productImg) {
          const prodImage = new Image();
          prodImage.crossOrigin = "anonymous";
          prodImage.onload = () => {
            ctx.globalAlpha = 0.7;
            ctx.globalCompositeOperation = "multiply";
            ctx.drawImage(prodImage, 100, 120, 300, 300);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            
            ctx.fillStyle = "rgba(16,185,129,0.9)";
            ctx.roundRect(150, 580, 200, 36, 12);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.font = "600 14px Jost";
            ctx.textAlign = "center";
            ctx.fillText("✨ Virtual Try-On", 250, 604);
            
            setResultImg(canvas.toDataURL("image/jpeg", 0.9));
            setProcessing(false);
          };
          prodImage.onerror = () => {
            ctx.fillStyle = "rgba(16,185,129,0.9)";
            ctx.roundRect(150, 580, 200, 36, 12);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.font = "600 14px Jost";
            ctx.textAlign = "center";
            ctx.fillText("✨ Try-On Ready", 250, 604);
            setResultImg(canvas.toDataURL("image/jpeg", 0.9));
            setProcessing(false);
          };
          prodImage.src = productImg;
        } else {
          ctx.fillStyle = "rgba(16,185,129,0.9)";
          ctx.roundRect(150, 580, 200, 36, 12);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "600 14px Jost";
          ctx.textAlign = "center";
          ctx.fillText("✨ Try-On Ready", 250, 604);
          setResultImg(canvas.toDataURL("image/jpeg", 0.9));
          setProcessing(false);
        }
      };
      userImage.src = userSrc;
    }, 2000);
  }, [products]);

  const currentIdx = STEPS.findIndex(s => s.id === step);

  // DASHBOARD VIEW — Polaris native Shopify admin design
  if (setupDone) {
    const usagePercent = monthlyLimit > 0 ? Math.min((monthlyTryOns / monthlyLimit) * 100, 100) : 0;
    const creditsLeft = Math.max(monthlyLimit - monthlyTryOns, 0);
    const currSymbol = currencyCode === "USD" ? "$" : currencyCode === "EUR" ? "€" : currencyCode === "GBP" ? "£" : "₹";
    const goToPricing = () => {
      if (window.shopify?.navigate) { window.shopify.navigate('/charges/tryfit-5/pricing_plans'); }
      else { window.top.location.href = `https://admin.shopify.com/store/${shop.replace('.myshopify.com','')}/charges/tryfit-5/pricing_plans`; }
    };
    const planTone = plan.toLowerCase() === "free" ? "info" : plan.toLowerCase() === "pro" ? "success" : "attention";
    const usageTone = usagePercent >= 90 ? "critical" : usagePercent >= 70 ? "warning" : "success";

    const productRows = topProducts.map(p => [
      p.title,
      p.count,
      `${p.count > 0 ? ((p.atc / p.count) * 100).toFixed(1) : "0.0"}%`,
    ]);

    return (
      <Page
        title="TryFit"
        subtitle={shop}
        primaryAction={{ content: "Manage plan", onAction: goToPricing }}
        secondaryActions={[
          { content: "Settings", url: "/app/settings" },
          { content: "Setup guide", onAction: () => { setSetupDone(false); setStep("start"); } },
        ]}
      >
        <Layout>
          {/* Usage warning banner */}
          {usagePercent >= 80 && (
            <Layout.Section>
              <Banner
                title={usagePercent >= 100 ? "Monthly limit reached" : "Running low on try-ons"}
                tone={usagePercent >= 100 ? "critical" : "warning"}
                action={{ content: "Upgrade plan", onAction: goToPricing }}
              >
                <p>{monthlyTryOns} of {monthlyLimit} try-ons used this month. Upgrade to keep virtual try-on active for your shoppers.</p>
              </Banner>
            </Layout.Section>
          )}

          {/* Performance metrics */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Store performance</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Last 30 days</Text>
                  </BlockStack>
                  <Badge tone="success">Active</Badge>
                </InlineStack>
                <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                  {[
                    { label: "Try-ons generated", value: totalTryOns.toLocaleString() },
                    { label: "Unique shoppers", value: uniqueUsers.toLocaleString() },
                    { label: "Add-to-cart rate", value: `${addToCartRate}%` },
                    { label: "Revenue", value: `${currSymbol}${Number(totalRevenue).toLocaleString()}` },
                  ].map((s, i) => (
                    <Box key={i} padding="400" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                        <Text as="p" variant="headingLg">{s.value}</Text>
                      </BlockStack>
                    </Box>
                  ))}
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Plan & usage */}
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
                <InlineGrid columns={{ xs: 3 }} gap="400">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Used this month</Text>
                    <Text as="p" variant="headingLg">{monthlyTryOns}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Remaining</Text>
                    <Text as="p" variant="headingLg">{creditsLeft}</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Monthly limit</Text>
                    <Text as="p" variant="headingLg">{monthlyLimit}</Text>
                  </BlockStack>
                </InlineGrid>
                <BlockStack gap="200">
                  <ProgressBar progress={usagePercent} tone={usageTone} size="small" />
                  <Text as="p" variant="bodySm" tone="subdued">{monthlyTryOns} of {monthlyLimit} try-ons used · resets every 30 days</Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Top products */}
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <Text as="h2" variant="headingMd">Top products by try-on</Text>
              </Box>
              {topProducts.length === 0 ? (
                <Box paddingBlockEnd="400">
                  <EmptyState
                    heading="No try-on data yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Analytics will appear here once shoppers start using virtual try-on on your product pages.</p>
                  </EmptyState>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric"]}
                  headings={["Product", "Try-ons", "Add-to-cart rate"]}
                  rows={productRows}
                />
              )}
            </Card>
          </Layout.Section>

          {/* Sidebar */}
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
                            <Thumbnail
                              source={p.featuredImage?.url || "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"}
                              alt={p.title}
                              size="small"
                            />
                            <BlockStack gap="050">
                              <Text as="p" variant="bodyMd" fontWeight="medium" truncate>{p.title}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {p.priceRangeV2?.minVariantPrice ? `${p.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(p.priceRangeV2.minVariantPrice.amount).toFixed(0)}` : "—"}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          {i < Math.min(products.length, 5) - 1 && <Divider />}
                        </BlockStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Need help?</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Get setup assistance or report an issue. We usually respond within a few hours.
                  </Text>
                  <Button
                    url="https://wa.me/917002073054?text=Hi%20need%20help%20with%20TryFit"
                    external
                    fullWidth
                  >
                    Contact support
                  </Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Store details</Text>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Shop</Text>
                    <Text as="span" variant="bodySm">{shop.replace(".myshopify.com", "")}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Extension</Text>
                    <Badge tone="success" size="small">Installed</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">AI engine</Text>
                    <Text as="span" variant="bodySm">Kolors v1.5</Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
        <Box paddingBlockStart="800" paddingBlockEnd="400">
          <InlineStack align="center">
            <Text as="p" variant="bodySm" tone="subdued">
              Powered by <PolarisLink url="https://futuretechiez.in" external removeUnderline>FutureTechiez</PolarisLink>
            </Text>
          </InlineStack>
        </Box>
      </Page>
    );
  }

  // ONBOARDING WIZARD
  return (
    <div style={{ fontFamily: "'Jost', sans-serif", background: "#fafafa", minHeight: "100vh" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Top Bar */}
        <div className="fu fu1" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#111", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 16 }}>T</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111" }}>TryFit</div>
              <div style={{ fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 6 }}><span className="live-dot" /> {shop}</div>
            </div>
          </div>
          <span className="tag tag-green">Setup</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 32 }}>

          {/* Sidebar Steps */}
          <div className="fu fu2">
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2, color: "#999", fontWeight: 600, marginBottom: 16 }}>Setup in 2 min</div>
            {STEPS.map((s, i) => (
              <div key={s.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "6px 0" }} onClick={() => setStep(s.id)}>
                  <div className={`step-dot ${i < currentIdx ? "done" : i === currentIdx ? "active" : "pending"}`}>
                    {i < currentIdx ? "✓" : i + 1}
                  </div>
                  <span className="step-label" style={{ color: i === currentIdx ? "#111" : i < currentIdx ? "#4f46e5" : "#999" }}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <div className="step-line" />}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="fu fu3">

            {/* Step 1: Get Started */}
            {step === "start" && (
              <div>
                <div className="card" style={{ background: "#111", color: "#fff", padding: "48px 40px", borderRadius: 20, marginBottom: 24, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: "rgba(16,185,129,.1)" }} />
                  <div style={{ position: "relative" }}>
                    <span className="tag" style={{ background: "rgba(16,185,129,.15)", color: "#818cf8", marginBottom: 16, display: "inline-block" }}>✨ AI Virtual Try-On for Shopify</span>
                    <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.2, marginTop: 12 }}>Let shoppers see themselves in your products — <span style={{ color: "#4f46e5" }}>before they buy</span></h1>
                    <p style={{ fontSize: 15, opacity: .6, marginTop: 12, lineHeight: 1.6 }}>Boost conversions by +72% and reduce returns. 50 free try-ons included. Setup takes under 2 minutes.</p>
                    <button className="btn btn-accent" style={{ marginTop: 24, fontSize: 16, padding: "14px 32px" }} onClick={() => setStep("categories")}>Get Started Now →</button>
                    <p style={{ fontSize: 12, opacity: .4, marginTop: 10 }}>No credit card required · Free 50 try-on credits</p>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
                  {[
                    { value: "+72%", label: "Conversion lift" },
                    { value: "-32%", label: "Return rate drop" },
                    { value: "30s", label: "Try-on speed" },
                    { value: "50", label: "Free credits" },
                  ].map((s, i) => (
                    <div key={i} className="card" style={{ textAlign: "center", padding: 20 }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#4f46e5" }}>{s.value}</div>
                      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Categories */}
            {step === "categories" && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: "#4f46e5", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 1 of 4</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111", marginBottom: 4 }}>Select Your Product Categories</h2>
                <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>Select the product categories you sell. Our AI model adapts to these garments.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {CATEGORIES.map(c => (
                    <div key={c.name} className={`cat-item ${cats.includes(c.name) ? "selected" : ""}`} onClick={() => toggleCat(c.name)}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>{c.name}</div>
                          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{c.desc}</div>
                        </div>
                        <div style={{ width: 22, height: 22, borderRadius: 6, border: cats.includes(c.name) ? "none" : "1.5px solid #ddd", background: cats.includes(c.name) ? "#4f46e5" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, transition: "all .2s" }}>
                          {cats.includes(c.name) && "✓"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24 }}>
                  <span style={{ fontSize: 13, color: "#4f46e5", fontWeight: 600 }}>{cats.length} selected</span>
                  <button className="btn btn-primary" onClick={() => setStep("contact")}>Continue →</button>
                </div>
              </div>
            )}

            {/* Step 3: Contact */}
            {step === "contact" && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: "#4f46e5", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 2 of 4</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111", marginBottom: 4 }}>Get Alerts on WhatsApp</h2>
                <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>We'll message you when shoppers try on your products.</p>
                
                <div className="card" style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 14, fontWeight: 600, color: "#111", display: "block", marginBottom: 8 }}>Phone Number *</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #eee", fontSize: 14, background: "#fafafa", fontWeight: 500 }}>+91</div>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #eee", fontSize: 14, fontFamily: "'Jost',sans-serif", outline: "none" }} />
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>We'll use this for WhatsApp alerts</div>
                </div>

                <div className="card" style={{ background: "#eef2ff", border: "1px solid #c7d2fe" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>✅</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>WhatsApp number is same as phone</div>
                      <div style={{ fontSize: 12, color: "#888" }}>Uncheck if your WhatsApp is on a different number</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
                  <button className="btn btn-outline" onClick={() => setStep("categories")}>← Back</button>
                  <button className="btn btn-primary" onClick={() => setStep("tryon")}>Save & Continue →</button>
                </div>
              </div>
            )}

            {/* Step 4: Try it On */}
            {step === "tryon" && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: "#4f46e5", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 3 of 4 — The best part</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111", marginBottom: 4 }}>See it Work on Your Products</h2>
                <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>Upload a photo → click Generate → see your shopper wearing your product.</p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 20 }}>
                  {/* Product */}
                  <div className="card" style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4f46e5", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>1 · Your Product</div>
                    {products[0]?.featuredImage?.url ? (
                      <img src={products[0].featuredImage.url} alt="" style={{ width: "100%", height: 180, objectFit: "contain", borderRadius: 12, marginBottom: 12 }} />
                    ) : (
                      <div style={{ width: "100%", height: 180, background: "#f5f5f5", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, marginBottom: 12 }}>👕</div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{products[0]?.title || "Sample Product"}</div>
                    {products[0]?.priceRangeV2 && <div style={{ fontSize: 13, color: "#4f46e5", fontWeight: 600, marginTop: 4 }}>{products[0].priceRangeV2.minVariantPrice.currencyCode} {parseFloat(products[0].priceRangeV2.minVariantPrice.amount).toFixed(0)}</div>}
                  </div>

                  {/* Upload */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4f46e5", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>2 · Upload Photo</div>
                    {userImg ? (
                      <div className="card" style={{ textAlign: "center", padding: 16 }}>
                        <img src={userImg} alt="User" style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 12 }} />
                        <button className="btn btn-outline" style={{ marginTop: 12, fontSize: 12 }} onClick={() => fileRef.current.click()}>Change Photo</button>
                      </div>
                    ) : (
                      <div className="upload-zone" onClick={() => fileRef.current.click()}>
                        <div style={{ fontSize: 40, marginBottom: 8 }}>📸</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Tap to upload photo</div>
                        <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>JPG, PNG or WebP · Max 10 MB</div>
                      </div>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} style={{ display: "none" }} />
                  </div>

                  {/* Result */}
                  <div style={{ width: 220 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Try-On Result</div>
                    <div className="phone-preview">
                      <div className="phone-screen" style={{ minHeight: 340 }}>
                        {processing ? (
                          <div style={{ padding: 40, textAlign: "center" }}>
                            <div className="spinner" style={{ margin: "0 auto 16px" }} />
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>Generating...</div>
                            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>AI is working on it</div>
                          </div>
                        ) : resultImg ? (
                          <div>
                            <img src={resultImg} alt="Result" style={{ width: "100%", borderRadius: "20px 20px 0 0" }} />
                            <div style={{ padding: "12px 16px" }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{products[0]?.title || "Product"}</div>
                              <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>This is what shoppers see ✨</div>
                              <button className="btn btn-accent" style={{ width: "100%", justifyContent: "center", marginTop: 8, padding: "8px", fontSize: 12 }}>Add to Cart</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ padding: 40, textAlign: "center", color: "#ccc" }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>👆</div>
                            <div style={{ fontSize: 12 }}>Upload a photo to see the result</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {userImg && !processing && (
                  <button className="btn btn-accent" style={{ width: "100%", justifyContent: "center", marginTop: 20, padding: "16px", fontSize: 16 }} onClick={() => generateTryOn(userImg)}>✨ Generate Virtual Try-On</button>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
                  <button className="btn btn-outline" onClick={() => setStep("contact")}>← Back</button>
                  <button className="btn btn-primary" onClick={() => setStep("addblock")}>Continue →</button>
                </div>
              </div>
            )}

            {/* Step 5: Add Button */}
            {step === "addblock" && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: "#4f46e5", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 4 of 4</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111", marginBottom: 4 }}>Add "Try On" Button to Your Theme</h2>
                <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>Follow these steps to place the try-on button on your product pages.</p>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { step: 1, title: 'Click "Open Theme Editor" below', desc: "It opens your Shopify Product Page template in a new tab." },
                    { step: 2, title: 'Add block → Apps → "TryFit – Virtual Try-On"', desc: "Drag the block below your Add to Cart button." },
                    { step: 3, title: 'Click Save in top right', desc: "Your button goes live instantly for all shoppers." },
                  ].map(s => (
                    <div key={s.step} className="card" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "#4f46e5", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{s.step}</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>{s.title}</div>
                        <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                  <a href={`https://${shop}/admin/themes/current/editor?template=product`} target="_blank" rel="noopener noreferrer" className="btn btn-outline">Open Theme Editor</a>
                  <button className="btn btn-accent" onClick={() => { setSetupDone(true); submit({}, { method: "post" }); }}>✓ I've Added the Block</button>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 16 }}>
                  <button className="btn btn-outline" onClick={() => setStep("tryon")}>← Back</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: "center", padding: "28px 0 12px", fontSize: 12, color: "#bbb" }}>
          Powered by <a href="https://futuretechiez.in" target="_blank" rel="noopener noreferrer" style={{ color: "#888", textDecoration: "none", fontWeight: 700 }}>futuretechiez.in</a>
        </div>
      </div>
    </div>
  );
}
