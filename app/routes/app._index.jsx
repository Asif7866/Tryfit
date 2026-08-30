import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Badge, Box, Divider, InlineGrid, Button, ProgressBar,
  Banner
} from "@shopify/polaris";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await shopify.authenticate.admin(request);
    const shop = session.shop;

    const res = await admin.graphql(`{
      products(first: 8, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            id
            title
            status
            totalInventory
            priceRangeV2 { minVariantPrice { amount currencyCode } }
            featuredImage { url }
          }
        }
      }
      productsCount { count }
      orders(first: 1, sortKey: CREATED_AT, reverse: true) {
        edges { node { id name totalPriceSet { shopMoney { amount currencyCode } } } }
      }
      ordersCount { count }
    }`);
    const data = await res.json();
    const products = data.data.products.edges.map(e => e.node);
    const totalProducts = data.data.productsCount.count;
    const totalOrders = data.data.ordersCount.count;

    return json({ shop, products, totalProducts, totalOrders, error: null });
  } catch (e) {
    return json({ shop: "unknown", products: [], totalProducts: 0, totalOrders: 0, error: e.message });
  }
};

const styles = {
  gradient: {
    background: "linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 50%, #16213e 100%)",
    borderRadius: 16, padding: "28px 32px", color: "#fff", position: "relative", overflow: "hidden"
  },
  statCard: {
    background: "#fff", borderRadius: 14, padding: "22px 24px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)",
    border: "1px solid #f0f0f0", transition: "box-shadow 0.2s",
  },
  productRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 16px", borderRadius: 12, background: "#fafafa",
    border: "1px solid #f3f3f3", transition: "background 0.15s",
  },
  productImg: {
    width: 44, height: 44, borderRadius: 10, objectFit: "cover",
    border: "1px solid #eee",
  },
  badge: (bg, color) => ({
    display: "inline-block", padding: "3px 10px", borderRadius: 20,
    fontSize: 11, fontWeight: 600, background: bg, color: color,
    letterSpacing: "0.3px",
  }),
  footer: {
    textAlign: "center", padding: "20px 0 8px", opacity: 0.5,
    fontSize: 11, letterSpacing: "0.5px",
  },
};

export default function Index() {
  const { shop, products, totalProducts, totalOrders, error } = useLoaderData();

  if (error) {
    return (
      <Page title="Dashboard">
        <Banner tone="critical" title="Connection Error">
          <p>{error}</p>
        </Banner>
      </Page>
    );
  }

  const tryOnsUsed = 0;
  const tryOnLimit = 50;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px" }}>

      {/* Hero Section */}
      <div style={styles.gradient}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />
        <div style={{ position: "absolute", bottom: -60, left: "30%", width: 220, height: 220, borderRadius: "50%", background: "rgba(255,255,255,0.02)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, opacity: 0.5, marginBottom: 6 }}>Virtual Try-On</div>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.5px" }}>TryFit Dashboard</div>
              <div style={{ fontSize: 13, opacity: 0.6, marginTop: 6 }}>{shop}</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={styles.badge("rgba(52,211,153,0.15)", "#34d399")}>● Live</span>
              <Link to="/app/settings" style={{ textDecoration: "none" }}>
                <span style={{ ...styles.badge("rgba(255,255,255,0.1)", "#fff"), cursor: "pointer" }}>⚙ Settings</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginTop: 20 }}>
        <div style={styles.statCard}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 8 }}>Products</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#111" }}>{totalProducts}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>in your store</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 8 }}>Orders</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#111" }}>{totalOrders}</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>all time</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 8 }}>Try-Ons Used</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#111" }}>{tryOnsUsed}<span style={{ fontSize: 14, color: "#bbb", fontWeight: 400 }}> / {tryOnLimit}</span></div>
          <div style={{ marginTop: 8, height: 4, borderRadius: 4, background: "#f0f0f0", overflow: "hidden" }}>
            <div style={{ width: `${(tryOnsUsed/tryOnLimit)*100}%`, height: "100%", background: "linear-gradient(90deg, #34d399, #10b981)", borderRadius: 4 }} />
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 8 }}>Conversion</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#111" }}>—</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>needs try-on data</div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, marginTop: 20 }}>

        {/* Products List */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Products</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Try-on eligible products</div>
            </div>
            <span style={styles.badge("#f0f0f0", "#555")}>{totalProducts} total</span>
          </div>

          {products.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div>No products found. Add products to your store.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {products.map((p) => (
                <div key={p.id} style={styles.productRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {p.featuredImage?.url ? (
                      <img src={p.featuredImage.url} alt="" style={styles.productImg} />
                    ) : (
                      <div style={{ ...styles.productImg, background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📷</div>
                    )}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{p.title}</div>
                      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                        {p.priceRangeV2?.minVariantPrice ? 
                          `${p.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(p.priceRangeV2.minVariantPrice.amount).toFixed(0)}` : "—"
                        } · Stock: {p.totalInventory ?? "N/A"}
                      </div>
                    </div>
                  </div>
                  <span style={styles.badge(
                    p.status === "ACTIVE" ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.12)",
                    p.status === "ACTIVE" ? "#059669" : "#d97706"
                  )}>{p.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Setup Checklist */}
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 16 }}>Quick Setup</div>
            {[
              { done: true, text: "App installed" },
              { done: true, text: "Extension deployed" },
              { done: false, text: "Add Replicate API token" },
              { done: false, text: "Enable on product page" },
              { done: false, text: "First try-on test" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < 4 ? "1px solid #f5f5f5" : "none" }}>
                <span style={{ fontSize: 16 }}>{item.done ? "✅" : "○"}</span>
                <span style={{ fontSize: 13, color: item.done ? "#111" : "#888", textDecoration: item.done ? "none" : "none" }}>{item.text}</span>
              </div>
            ))}
          </div>

          {/* Plan Card */}
          <div style={{ background: "linear-gradient(135deg, #0f0f0f, #1a1a2e)", borderRadius: 16, padding: "24px", color: "#fff" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, opacity: 0.5 }}>Current Plan</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Free</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>50 try-ons / month</div>
            <div style={{ marginTop: 16, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Upgrade for unlimited try-ons, analytics, and priority support.</div>
            </div>
          </div>

          {/* Store Info */}
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 16 }}>Store Info</div>
            {[
              ["Shop", shop],
              ["Extension", "Installed"],
              ["API Version", "2024-10"],
            ].map(([label, value], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 2 ? "1px solid #f5f5f5" : "none" }}>
                <span style={{ fontSize: 13, color: "#888" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        Powered by <a href="https://futuretechiez.in" target="_blank" rel="noopener noreferrer" style={{ color: "#555", textDecoration: "none", fontWeight: 600 }}>futuretechiez.in</a>
      </div>
    </div>
  );
}
