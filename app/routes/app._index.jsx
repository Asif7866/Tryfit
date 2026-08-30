import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await shopify.authenticate.admin(request);
    const res = await admin.graphql(`{
      products(first: 8, sortKey: UPDATED_AT, reverse: true) {
        edges { node { id title status totalInventory priceRangeV2 { minVariantPrice { amount currencyCode } } featuredImage { url } } }
      }
      productsCount { count }
      ordersCount { count }
    }`);
    const data = await res.json();
    return json({
      shop: session.shop,
      products: data.data.products.edges.map(e => e.node),
      totalProducts: data.data.productsCount.count,
      totalOrders: data.data.ordersCount.count,
      error: null
    });
  } catch (e) {
    return json({ shop: "unknown", products: [], totalProducts: 0, totalOrders: 0, error: e.message });
  }
};

export default function Index() {
  const { shop, products, totalProducts, totalOrders, error } = useLoaderData();

  if (error) {
    return <div style={{ padding: 40, fontFamily: "Inter, system-ui, sans-serif" }}>
      <h2 style={{ color: "#ef4444" }}>Connection Error</h2>
      <p style={{ color: "#888" }}>{error}</p>
    </div>;
  }

  const tryOnsUsed = 0, tryOnLimit = 50;

  return (
    <div style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif", background: "#09090b", minHeight: "100vh", color: "#fff" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
        @keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .fade-up { animation: fadeUp 0.6s ease-out forwards; opacity: 0; }
        .fade-up-1 { animation-delay: 0.1s; } .fade-up-2 { animation-delay: 0.2s; }
        .fade-up-3 { animation-delay: 0.3s; } .fade-up-4 { animation-delay: 0.4s; }
        .fade-up-5 { animation-delay: 0.5s; } .fade-up-6 { animation-delay: 0.6s; }
        .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.06); }
        .glass:hover { border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); }
        .stat-card { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor: default; }
        .stat-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
        .product-row { transition: all 0.2s ease; }
        .product-row:hover { background: rgba(255,255,255,0.08) !important; transform: translateX(4px); }
        .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; display: inline-block; }
        .gradient-text { background: linear-gradient(135deg, #a78bfa, #818cf8, #6366f1); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-size: 200% auto; animation: gradientShift 3s ease infinite; }
        .glow-border { position: relative; }
        .glow-border::before { content: ''; position: absolute; inset: -1px; border-radius: inherit; padding: 1px; background: linear-gradient(135deg, rgba(167,139,250,0.3), rgba(99,102,241,0.1), rgba(167,139,250,0.3)); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
        .progress-glow { box-shadow: 0 0 12px rgba(167,139,250,0.4); }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "24px 20px" }}>

        {/* Hero */}
        <div className="fade-up fade-up-1" style={{ position: "relative", borderRadius: 24, overflow: "hidden", padding: "36px 40px", marginBottom: 24, background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4338ca 100%)", backgroundSize: "200% 200%", animation: "gradientShift 8s ease infinite" }}>
          <div style={{ position: "absolute", top: -80, right: -80, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(167,139,250,0.15), transparent 70%)" }} />
          <div style={{ position: "absolute", bottom: -100, left: "20%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.1), transparent 70%)" }} />
          <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 3, opacity: 0.5, marginBottom: 8, fontWeight: 500 }}>Virtual Try-On Platform</div>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-1px", lineHeight: 1.1 }}>
                <span className="gradient-text">TryFit</span> Dashboard
              </div>
              <div style={{ fontSize: 13, opacity: 0.5, marginTop: 8, fontWeight: 400 }}>{shop}</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
                <span className="live-dot" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#22c55e" }}>Live</span>
              </div>
              <Link to="/app/settings" style={{ textDecoration: "none", padding: "6px 16px", borderRadius: 20, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 12, fontWeight: 500, transition: "all 0.2s" }}>⚙ Settings</Link>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
          {[
            { label: "PRODUCTS", value: totalProducts, sub: "in your store", icon: "📦", color: "#a78bfa" },
            { label: "ORDERS", value: totalOrders, sub: "all time", icon: "🛒", color: "#60a5fa" },
            { label: "TRY-ONS", value: `${tryOnsUsed}`, sub: `${tryOnLimit - tryOnsUsed} remaining`, icon: "✨", color: "#34d399", showBar: true },
            { label: "CONVERSION", value: "—", sub: "needs data", icon: "📈", color: "#fbbf24" },
          ].map((s, i) => (
            <div key={i} className={`stat-card glass fade-up fade-up-${i+2}`} style={{ borderRadius: 20, padding: "24px 22px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 16, right: 16, fontSize: 28, opacity: 0.15, animation: "float 3s ease-in-out infinite", animationDelay: `${i * 0.3}s` }}>{s.icon}</div>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2, color: "#666", fontWeight: 600, marginBottom: 10 }}>{s.label}</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: s.color, letterSpacing: "-1px" }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 6, fontWeight: 400 }}>{s.sub}</div>
              {s.showBar && (
                <div style={{ marginTop: 12, height: 4, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div className="progress-glow" style={{ width: `${Math.max((tryOnsUsed/tryOnLimit)*100, 2)}%`, height: "100%", background: `linear-gradient(90deg, ${s.color}, ${s.color}88)`, borderRadius: 4, transition: "width 1s ease" }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Main Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>

          {/* Products */}
          <div className="glass fade-up fade-up-5" style={{ borderRadius: 20, padding: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Products</div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>Try-on eligible products</div>
              </div>
              <div style={{ padding: "4px 12px", borderRadius: 12, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>{totalProducts} total</div>
            </div>

            {products.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#555" }}>
                <div style={{ fontSize: 40, marginBottom: 12, animation: "float 3s ease-in-out infinite" }}>📦</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>No products yet</div>
                <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>Add products to your Shopify store</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {products.map((p, i) => (
                  <div key={p.id} className="product-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)", animationDelay: `${i * 0.05}s` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      {p.featuredImage?.url ? (
                        <img src={p.featuredImage.url} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover", border: "1px solid rgba(255,255,255,0.08)" }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📷</div>
                      )}
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                          {p.priceRangeV2?.minVariantPrice ? `${p.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(p.priceRangeV2.minVariantPrice.amount).toFixed(0)}` : "—"} · Stock: {p.totalInventory ?? "N/A"}
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: "3px 10px", borderRadius: 8, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
                      background: p.status === "ACTIVE" ? "rgba(34,197,94,0.1)" : "rgba(251,191,36,0.1)",
                      color: p.status === "ACTIVE" ? "#22c55e" : "#fbbf24",
                      border: `1px solid ${p.status === "ACTIVE" ? "rgba(34,197,94,0.2)" : "rgba(251,191,36,0.2)"}`,
                    }}>{p.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Quick Setup */}
            <div className="glass fade-up fade-up-5" style={{ borderRadius: 20, padding: "24px" }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Quick Setup</div>
              {[
                { done: true, text: "App installed" },
                { done: true, text: "Extension deployed" },
                { done: false, text: "Add Replicate API token" },
                { done: false, text: "Enable on product page" },
                { done: false, text: "First try-on test" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                    background: item.done ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${item.done ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
                    color: item.done ? "#22c55e" : "#555",
                  }}>{item.done ? "✓" : ""}</div>
                  <span style={{ fontSize: 13, color: item.done ? "#ccc" : "#666", fontWeight: item.done ? 400 : 500 }}>{item.text}</span>
                </div>
              ))}
            </div>

            {/* Plan */}
            <div className="glow-border fade-up fade-up-6" style={{ borderRadius: 20, padding: "28px", background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(167,139,250,0.04))", border: "1px solid rgba(167,139,250,0.1)" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2, color: "#a78bfa", fontWeight: 600 }}>Current Plan</div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>Free</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>50 try-ons / month</div>
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 12, color: "#666", lineHeight: 1.5 }}>
                Upgrade for unlimited try-ons, advanced analytics, and priority support.
              </div>
            </div>

            {/* WhatsApp */}
            <a href="https://wa.me/917002073054?text=Hi%2C%20I%20need%20help%20with%20TryFit" target="_blank" rel="noopener noreferrer" className="fade-up fade-up-6" style={{ textDecoration: "none", display: "block", borderRadius: 20, padding: "20px 24px", background: "linear-gradient(135deg, #25D366, #128C7E)", transition: "transform 0.2s, box-shadow 0.2s", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#fff" }}>
                <span style={{ fontSize: 24 }}>💬</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Need Help?</div>
                  <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>Chat with us on WhatsApp</div>
                </div>
              </div>
            </a>

            {/* Store Info */}
            <div className="glass fade-up fade-up-6" style={{ borderRadius: 20, padding: "24px" }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Store Info</div>
              {[["Shop", shop], ["Extension", "Active"], ["API", "2024-10"]].map(([l, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                  <span style={{ fontSize: 12, color: "#555" }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#aaa" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", padding: "32px 0 16px", fontSize: 11, letterSpacing: "0.5px" }}>
          <span style={{ color: "#333" }}>Powered by </span>
          <a href="https://futuretechiez.in" target="_blank" rel="noopener noreferrer" style={{ color: "#a78bfa", textDecoration: "none", fontWeight: 600 }}>futuretechiez.in</a>
        </div>
      </div>
    </div>
  );
}
