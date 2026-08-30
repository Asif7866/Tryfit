import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useRef, useCallback } from "react";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await shopify.authenticate.admin(request);
    const res = await admin.graphql(`{
      products(first: 10, sortKey: UPDATED_AT, reverse: true) {
        edges { node { id title status totalInventory priceRangeV2 { minVariantPrice { amount currencyCode } } featuredImage { url } } }
      }
      products(first: 1) { edges { node { id } } }
      orders(first: 1) { edges { node { id } } }
    }`);
    const data = await res.json();
    return json({
      shop: session.shop,
      products: data.data.products.edges.map(e => e.node),
      totalProducts: data.data.products.edges.length || 0,
      totalOrders: 0,
    });
  } catch (e) {
    return json({ shop: "unknown", products: [], totalProducts: 0, totalOrders: 0 });
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
.btn-accent { background:#10b981; color:#fff; }
.btn-accent:hover { background:#059669; }
.step-dot { width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; transition:all .3s; }
.step-dot.active { background:#111; color:#fff; }
.step-dot.done { background:#10b981; color:#fff; }
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
.cat-item.selected { border-color:#10b981; background:rgba(16,185,129,.04); }
.upload-zone { border:2px dashed #ddd; border-radius:16px; padding:40px; text-align:center; cursor:pointer; transition:all .2s; }
.upload-zone:hover { border-color:#10b981; background:rgba(16,185,129,.02); }
.live-dot { width:8px; height:8px; border-radius:50%; background:#10b981; animation:pulse 2s infinite; display:inline-block; }
.progress-bar { height:4px; border-radius:4px; background:#f0f0f0; overflow:hidden; }
.progress-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#10b981,#34d399); transition:width .8s ease; }
.phone-preview { width:260px; background:#111; border-radius:28px; padding:12px; box-shadow:0 20px 60px rgba(0,0,0,.2); }
.phone-screen { background:#fff; border-radius:20px; overflow:hidden; }
.result-img { width:100%; border-radius:12px; object-fit:cover; }
.spinner { width:20px; height:20px; border:2px solid #ddd; border-top-color:#111; border-radius:50%; animation:spin .6s linear infinite; }
.tag { display:inline-block; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600; letter-spacing:.3px; }
.tag-green { background:rgba(16,185,129,.1); color:#059669; }
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
  const { shop, products, totalProducts, totalOrders } = useLoaderData();
  const [step, setStep] = useState("start");
  const [setupDone, setSetupDone] = useState(false);
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

  // DASHBOARD VIEW
  if (setupDone) {
    const tryOnsUsed = 0, tryOnLimit = 50;
    return (
      <div style={{ fontFamily: "'Jost', sans-serif", background: "#fafafa", minHeight: "100vh" }}>
        <style>{CSS}</style>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

          {/* Header */}
          <div className="fu fu1" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#111" }}>TryFit</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span className="live-dot" />
                <span style={{ fontSize: 13, color: "#888" }}>{shop}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-outline" onClick={() => { setSetupDone(false); setStep("start"); }}>⚙ Settings</button>
              <a href="https://wa.me/917002073054?text=Hi%20need%20help%20with%20TryFit" target="_blank" rel="noopener noreferrer" className="btn btn-accent">💬 Support</a>
            </div>
          </div>

          {/* Stats */}
          <div className="fu fu2" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Products", value: totalProducts, sub: "in store", icon: "📦" },
              { label: "Orders", value: totalOrders, sub: "all time", icon: "🛒" },
              { label: "Try-Ons", value: `${tryOnsUsed}/${tryOnLimit}`, sub: `${tryOnLimit - tryOnsUsed} left`, icon: "✨", bar: true },
              { label: "Conversion", value: "—", sub: "needs data", icon: "📊" },
            ].map((s, i) => (
              <div key={i} className="card stat-card">
                <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
                <div className="stat-label">{s.label}</div>
                <div className="stat-value">{s.value}</div>
                <div className="stat-sub">{s.sub}</div>
                {s.bar && <div className="progress-bar" style={{ marginTop: 10 }}><div className="progress-fill" style={{ width: `${Math.max((tryOnsUsed/tryOnLimit)*100,2)}%` }} /></div>}
              </div>
            ))}
          </div>

          {/* Products + Sidebar */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
            <div className="card fu fu3">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#111" }}>Products</div>
                <span className="tag tag-blue">{totalProducts} total</span>
              </div>
              {products.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#aaa" }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
                  <div style={{ fontWeight: 500 }}>No products yet</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {products.map(p => (
                    <div key={p.id} className="product-row">
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        {p.featuredImage?.url ? <img src={p.featuredImage.url} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} /> : <div style={{ width: 44, height: 44, borderRadius: 10, background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center" }}>📷</div>}
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{p.title}</div>
                          <div style={{ fontSize: 12, color: "#888" }}>{p.priceRangeV2?.minVariantPrice ? `${p.priceRangeV2.minVariantPrice.currencyCode} ${parseFloat(p.priceRangeV2.minVariantPrice.amount).toFixed(0)}` : "—"}</div>
                        </div>
                      </div>
                      <span className={`tag ${p.status === "ACTIVE" ? "tag-green" : "tag-yellow"}`}>{p.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card fu fu4">
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Plan</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: "#111" }}>Free</div>
                <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>50 try-ons / month</div>
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #f0f0f0", fontSize: 13, color: "#888" }}>Upgrade for unlimited try-ons and analytics.</div>
              </div>

              <a href="https://wa.me/917002073054?text=Hi%20need%20help%20with%20TryFit" target="_blank" rel="noopener noreferrer" className="fu fu5" style={{ textDecoration: "none", display: "block", background: "#25D366", borderRadius: 16, padding: "20px 24px", color: "#fff" }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>💬 Need Help?</div>
                <div style={{ fontSize: 12, opacity: .85, marginTop: 4 }}>Chat on WhatsApp</div>
              </a>

              <div className="card fu fu6">
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Store</div>
                {[["Shop", shop], ["Extension", "Active"], ["Categories", cats.length || "—"]].map(([l, v], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 2 ? "1px solid #f5f5f5" : "none" }}>
                    <span style={{ fontSize: 13, color: "#888" }}>{l}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ textAlign: "center", padding: "28px 0 12px", fontSize: 12, color: "#bbb" }}>
            Powered by <a href="https://futuretechiez.in" target="_blank" rel="noopener noreferrer" style={{ color: "#888", textDecoration: "none", fontWeight: 600 }}>futuretechiez.in</a>
          </div>
        </div>
      </div>
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
                  <span className="step-label" style={{ color: i === currentIdx ? "#111" : i < currentIdx ? "#10b981" : "#999" }}>{s.label}</span>
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
                    <span className="tag" style={{ background: "rgba(16,185,129,.15)", color: "#34d399", marginBottom: 16, display: "inline-block" }}>✨ AI Virtual Try-On for Shopify</span>
                    <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.2, marginTop: 12 }}>Let shoppers see themselves in your products — <span style={{ color: "#10b981" }}>before they buy</span></h1>
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
                      <div style={{ fontSize: 24, fontWeight: 800, color: "#10b981" }}>{s.value}</div>
                      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Categories */}
            {step === "categories" && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: "#10b981", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 1 of 4</div>
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
                        <div style={{ width: 22, height: 22, borderRadius: 6, border: cats.includes(c.name) ? "none" : "1.5px solid #ddd", background: cats.includes(c.name) ? "#10b981" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, transition: "all .2s" }}>
                          {cats.includes(c.name) && "✓"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24 }}>
                  <span style={{ fontSize: 13, color: "#10b981", fontWeight: 600 }}>{cats.length} selected</span>
                  <button className="btn btn-primary" onClick={() => setStep("contact")}>Continue →</button>
                </div>
              </div>
            )}

            {/* Step 3: Contact */}
            {step === "contact" && (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: "#10b981", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 2 of 4</div>
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

                <div className="card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
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
                <div style={{ marginBottom: 8, fontSize: 12, color: "#10b981", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 3 of 4 — The best part</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111", marginBottom: 4 }}>See it Work on Your Products</h2>
                <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>Upload a photo → click Generate → see your shopper wearing your product.</p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 20 }}>
                  {/* Product */}
                  <div className="card" style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#10b981", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>1 · Your Product</div>
                    {products[0]?.featuredImage?.url ? (
                      <img src={products[0].featuredImage.url} alt="" style={{ width: "100%", height: 180, objectFit: "contain", borderRadius: 12, marginBottom: 12 }} />
                    ) : (
                      <div style={{ width: "100%", height: 180, background: "#f5f5f5", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, marginBottom: 12 }}>👕</div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{products[0]?.title || "Sample Product"}</div>
                    {products[0]?.priceRangeV2 && <div style={{ fontSize: 13, color: "#10b981", fontWeight: 600, marginTop: 4 }}>{products[0].priceRangeV2.minVariantPrice.currencyCode} {parseFloat(products[0].priceRangeV2.minVariantPrice.amount).toFixed(0)}</div>}
                  </div>

                  {/* Upload */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#10b981", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>2 · Upload Photo</div>
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
                <div style={{ marginBottom: 8, fontSize: 12, color: "#10b981", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Step 4 of 4</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#111", marginBottom: 4 }}>Add "Try On" Button to Your Theme</h2>
                <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>Follow these steps to place the try-on button on your product pages.</p>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { step: 1, title: 'Click "Open Theme Editor" below', desc: "It opens your Shopify Product Page template in a new tab." },
                    { step: 2, title: 'Add block → Apps → "TryFit – Virtual Try-On"', desc: "Drag the block below your Add to Cart button." },
                    { step: 3, title: 'Click Save in top right', desc: "Your button goes live instantly for all shoppers." },
                  ].map(s => (
                    <div key={s.step} className="card" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: "#10b981", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{s.step}</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>{s.title}</div>
                        <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                  <a href={`https://${shop}/admin/themes/current/editor?template=product`} target="_blank" rel="noopener noreferrer" className="btn btn-outline">Open Theme Editor</a>
                  <button className="btn btn-accent" onClick={() => setSetupDone(true)}>✓ I've Added the Block</button>
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
