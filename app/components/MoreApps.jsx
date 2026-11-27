// "More apps by FutureTechiez" — a small row (can be hidden until the app is opened again) of our other Shopify apps (shown at the bottom of the home page).
// Self-contained (no UI library) so the same file works in every FutureTechiez app. Links open the Shopify App Store listing.
import { useEffect, useState } from "react";

const APPS = [
  { key: "clyvio", icon: "https://cdn.shopify.com/app-store/listing_images/fa646db50497bb46bc719765172d7483/icon/CJ3Lhv22gpcDEAE=.png", name: "Clyvio", tag: "Shoppable videos & reels", text: "Turn your reels into shoppable videos that sell, with an AI shopping assistant.", url: "https://apps.shopify.com/clyvio", mark: "C", color: "linear-gradient(135deg,#7c3aed,#4f46e5)" },
  { key: "wearoom", icon: "https://cdn.shopify.com/app-store/listing_images/801b072184a9733e9c66dc11391a28a5/icon/CNv73aHw8JcDEAE=.png", name: "Wearoom", tag: "AI try-on & room view", text: "Let shoppers try products on with AI before they buy. Fewer returns, more confidence.", url: "https://apps.shopify.com/tryfit-2", mark: "W", color: "linear-gradient(135deg,#ec4899,#f97316)" },
  { key: "rankai", icon: "https://cdn.shopify.com/app-store/listing_images/b84dec0655f85fa3c43de44a7471ad1c/icon/CIf5yKar85cDEAE=.png", name: "RankAI SEO", tag: "SEO on autopilot", text: "Get found on Google and AI search: meta, alt text, blogs and fixes done for you.", url: "https://apps.shopify.com/rankai-seo", mark: "R", color: "linear-gradient(135deg,#059669,#0ea5e9)" },
  { key: "goldpricer", icon: "https://cdn.shopify.com/app-store/listing_images/151e2d155902cbb539ee3055bd7b3517/icon/CIevv_-r85cDEAE=.png", name: "GoldPricer", tag: "Live jewellery rates", text: "Jewellery prices that follow live gold and silver rates automatically.", url: "https://apps.shopify.com/goldpricer", mark: "G", color: "linear-gradient(135deg,#d97706,#eab308)" },
];
// Hiding lasts only while the app stays open: the section is back the next time the merchant opens the app.
let hiddenNow = false;

// The app's real App Store icon; if it ever fails to load, a coloured letter tile is shown instead
function Logo({ a }) {
  const [bad, setBad] = useState(false);
  const box = { width: 40, height: 40, borderRadius: 10, flexShrink: 0 };
  if (a.icon && !bad) return <img src={a.icon} alt="" width="40" height="40" loading="lazy" onError={() => setBad(true)} style={{ ...box, objectFit: "cover", display: "block" }} />;
  return <span aria-hidden="true" style={{ ...box, background: a.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{a.mark}</span>;
}

export default function MoreApps({ current }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (hiddenNow) setHidden(true); }, []);
  if (hidden) return null;
  const list = APPS.filter((a) => a.key !== current);
  const hide = () => { hiddenNow = true; setHidden(true); };
  return (
    <section aria-label="More apps by FutureTechiez" style={{ marginTop: 24, padding: 16, background: "#fff", border: "1px solid #e3e3e3", borderRadius: 12, fontFamily: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 650, color: "#303030" }}>More apps by FutureTechiez</div>
          <div style={{ fontSize: 13, color: "#616161", marginTop: 2 }}>Built by the same team to help your store sell more.</div>
        </div>
        <button type="button" onClick={hide} aria-label="Hide this section" title="Hide" style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1, color: "#8a8a8a", padding: 4 }}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {list.map((a) => (
          <a key={a.key} href={a.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, border: "1px solid #ebebeb", borderRadius: 10, textDecoration: "none", color: "inherit", background: "#fafafa" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo a={a} />
              <span>
                <span style={{ display: "block", fontSize: 14, fontWeight: 650, color: "#303030" }}>{a.name}</span>
                <span style={{ display: "block", fontSize: 12, color: "#616161" }}>{a.tag}</span>
              </span>
            </div>
            <span style={{ fontSize: 13, color: "#4a4a4a", lineHeight: 1.45, flex: 1 }}>{a.text}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#005bd3" }}>View on Shopify App Store →</span>
          </a>
        ))}
      </div>
    </section>
  );
}
