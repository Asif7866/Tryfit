import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  TextField, Select, ColorPicker, Button, Divider,
  Badge, Banner, hsbToRgb, rgbToHsb
} from "@shopify/polaris";
import shopify from "../shopify.server";

const defaults = {
  buttonText: "Try On",
  buttonColor: "#111111",
  buttonTextColor: "#ffffff",
  buttonRadius: "12",
  buttonSize: "large",
  modalTitle: "Try it before you buy",
  modalSubtitle: "Upload your photo and see this on you in seconds",
  position: "below_cart",
  enabled: "true",
  maxFileSize: "10",
  brandName: "TryFit",
  poweredBy: "true",
};

export const loader = async ({ request }) => {
  try {
    const { session } = await shopify.authenticate.admin(request);
    return json({ shop: session.shop, settings: defaults, error: null });
  } catch (e) {
    return json({ shop: "unknown", settings: defaults, error: e.message });
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const settings = Object.fromEntries(formData);
  return json({ success: true, settings });
};

export default function Settings() {
  const { shop, settings: saved, error } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  const [s, setS] = useState(saved);
  const update = (key, val) => setS(prev => ({ ...prev, [key]: val }));

  const [btnHsb, setBtnHsb] = useState({ hue: 0, saturation: 0, brightness: 0.07 });

  const handleSave = () => {
    const formData = new FormData();
    Object.entries(s).forEach(([k, v]) => formData.append(k, v));
    submit(formData, { method: "post" });
  };

  const st = {
    section: { background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", padding: 28, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" },
    label: { fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 6, display: "block" },
    sublabel: { fontSize: 11, color: "#888", marginTop: 2 },
    input: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e5e5", fontSize: 14, outline: "none", transition: "border 0.2s" },
    select: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e5e5", fontSize: 14, background: "#fff" },
    colorSwatch: (color) => ({ width: 36, height: 36, borderRadius: 8, background: color, border: "2px solid #eee", cursor: "pointer" }),
    preview: {
      btn: { padding: "14px 32px", borderRadius: `${s.buttonRadius}px`, background: s.buttonColor, color: s.buttonTextColor, border: "none", fontSize: s.buttonSize === "large" ? 16 : s.buttonSize === "medium" ? 14 : 12, fontWeight: 600, cursor: "pointer", letterSpacing: "0.3px" },
    },
    footer: { textAlign: "center", padding: "20px 0 8px", opacity: 0.5, fontSize: 11, letterSpacing: "0.5px" },
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 0 20px" }}>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "#888" }}>Settings</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#111" }}>Customize TryFit</div>
          <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>{shop}</div>
        </div>
        <button onClick={handleSave} disabled={saving} style={{ padding: "12px 28px", borderRadius: 10, background: "#111", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {actionData?.success && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#065f46" }}>
          ✅ Settings saved successfully!
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>

        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Button Settings */}
          <div style={st.section}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 4 }}>Try-On Button</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 20 }}>Customize the button that appears on product pages</div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={st.label}>Button Text</label>
                <input style={st.input} value={s.buttonText} onChange={e => update("buttonText", e.target.value)} />
              </div>
              <div>
                <label style={st.label}>Button Size</label>
                <select style={st.select} value={s.buttonSize} onChange={e => update("buttonSize", e.target.value)}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div>
                <label style={st.label}>Border Radius (px)</label>
                <input style={st.input} type="number" value={s.buttonRadius} onChange={e => update("buttonRadius", e.target.value)} />
              </div>
              <div>
                <label style={st.label}>Position</label>
                <select style={st.select} value={s.position} onChange={e => update("position", e.target.value)}>
                  <option value="below_cart">Below Add to Cart</option>
                  <option value="above_cart">Above Add to Cart</option>
                  <option value="below_price">Below Price</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
              <div>
                <label style={st.label}>Button Color</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={s.buttonColor} onChange={e => update("buttonColor", e.target.value)} style={{ width: 40, height: 40, borderRadius: 8, border: "2px solid #eee", cursor: "pointer", padding: 0 }} />
                  <input style={{ ...st.input, width: 120 }} value={s.buttonColor} onChange={e => update("buttonColor", e.target.value)} />
                </div>
              </div>
              <div>
                <label style={st.label}>Text Color</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="color" value={s.buttonTextColor} onChange={e => update("buttonTextColor", e.target.value)} style={{ width: 40, height: 40, borderRadius: 8, border: "2px solid #eee", cursor: "pointer", padding: 0 }} />
                  <input style={{ ...st.input, width: 120 }} value={s.buttonTextColor} onChange={e => update("buttonTextColor", e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Modal Settings */}
          <div style={st.section}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 4 }}>Try-On Modal</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 20 }}>Customize the virtual try-on popup experience</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={st.label}>Modal Title</label>
                <input style={st.input} value={s.modalTitle} onChange={e => update("modalTitle", e.target.value)} />
              </div>
              <div>
                <label style={st.label}>Modal Subtitle</label>
                <input style={st.input} value={s.modalSubtitle} onChange={e => update("modalSubtitle", e.target.value)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={st.label}>Max Upload Size (MB)</label>
                  <input style={st.input} type="number" value={s.maxFileSize} onChange={e => update("maxFileSize", e.target.value)} />
                </div>
                <div>
                  <label style={st.label}>Brand Name</label>
                  <input style={st.input} value={s.brandName} onChange={e => update("brandName", e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* General */}
          <div style={st.section}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 4 }}>General</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 20 }}>App-wide settings</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={st.label}>Try-On Feature</label>
                <select style={st.select} value={s.enabled} onChange={e => update("enabled", e.target.value)}>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
              <div>
                <label style={st.label}>Show "Powered by"</label>
                <select style={st.select} value={s.poweredBy} onChange={e => update("poweredBy", e.target.value)}>
                  <option value="true">Yes</option>
                  <option value="false">No (Premium)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Button Preview */}
          <div style={{ ...st.section, position: "sticky", top: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 16 }}>Live Preview</div>
            
            {/* Product Preview */}
            <div style={{ background: "#fafafa", borderRadius: 14, padding: 20, border: "1px solid #f0f0f0" }}>
              <div style={{ width: "100%", height: 180, background: "#eee", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>👕</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Sample Product</div>
              <div style={{ fontSize: 13, color: "#888", margin: "4px 0 16px" }}>₹2,499.00</div>
              <button style={{ width: "100%", padding: "12px", borderRadius: 8, background: "#333", color: "#fff", border: "none", fontSize: 14, fontWeight: 500, marginBottom: 10, cursor: "pointer" }}>Add to Cart</button>
              <button style={{ width: "100%", ...st.preview.btn }}>{s.buttonText || "Try On"}</button>
            </div>

            {/* Modal Preview Mini */}
            <div style={{ marginTop: 16, background: "#fafafa", borderRadius: 14, padding: 20, border: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Modal Preview</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{s.modalTitle}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{s.modalSubtitle}</div>
              <div style={{ marginTop: 12, padding: 16, border: "2px dashed #ddd", borderRadius: 10, textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>📸</div>
                <div style={{ fontSize: 12, color: "#aaa" }}>Upload area</div>
              </div>
              {s.poweredBy === "true" && (
                <div style={{ textAlign: "center", marginTop: 10, fontSize: 10, color: "#bbb" }}>Powered by futuretechiez.in</div>
              )}
            </div>
          </div>

          {/* Support Card */}
          <div style={{ background: "linear-gradient(135deg, #25D366, #128C7E)", borderRadius: 16, padding: 24, color: "#fff" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Need Help?</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 16 }}>We're here to help you set up and get the most out of TryFit.</div>
            <a href="https://wa.me/917002073054?text=Hi%2C%20I%20need%20help%20with%20TryFit%20app" target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, background: "rgba(255,255,255,0.2)", color: "#fff", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
              💬 Chat on WhatsApp
            </a>
          </div>
        </div>
      </div>

      <div style={st.footer}>
        Powered by <a href="https://futuretechiez.in" target="_blank" rel="noopener noreferrer" style={{ color: "#555", textDecoration: "none", fontWeight: 600 }}>futuretechiez.in</a>
      </div>
    </div>
  );
}
