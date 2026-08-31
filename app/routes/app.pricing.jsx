import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { prisma } from "../shopify.server";

const PLANS = [
  { name: "Free", price: 0, tryOns: 10, features: ["10 try-ons/month", "Basic support", "1 product type"], tag: "" },
  { name: "Starter", price: 1999, tryOns: 200, features: ["200 try-ons/month", "Priority support", "All product types", "Analytics dashboard"], tag: "POPULAR" },
  { name: "Growth", price: 3999, tryOns: 600, features: ["600 try-ons/month", "Priority support", "All product types", "Analytics dashboard", "Custom branding"], tag: "" },
  { name: "Pro", price: 7999, tryOns: 2000, features: ["2,000 try-ons/month", "Dedicated support", "All product types", "Advanced analytics", "Custom branding", "API access"], tag: "BEST VALUE" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.shopSettings.create({ data: { shop } });
  }
  return json({ plan: settings.plan, monthlyTryOns: settings.monthlyTryOns, monthlyLimit: settings.monthlyLimit });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const planName = formData.get("plan");
  const selectedPlan = PLANS.find(p => p.name === planName);

  if (!selectedPlan) return json({ error: "Invalid plan" }, { status: 400 });

  // Free plan - just update DB
  if (selectedPlan.price === 0) {
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { plan: "free", monthlyLimit: 10, monthlyTryOns: 0 },
      create: { shop, plan: "free", monthlyLimit: 10 },
    });
    return json({ success: true });
  }

  // Paid plan - create Shopify subscription
  const response = await admin.graphql(`
    mutation createSubscription($name: String!, $price: Decimal!, $returnUrl: URL!, $trialDays: Int) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: $price, currencyCode: INR }
              }
            }
          }
        ]
      ) {
        appSubscription { id }
        confirmationUrl
        userErrors { field message }
      }
    }
  `, {
    variables: {
      name: `TryFit ${selectedPlan.name}`,
      price: selectedPlan.price,
      returnUrl: `https://tryfit-production.up.railway.app/app/pricing/callback?plan=${planName}&shop=${shop}`,
      trialDays: 3,
    },
  });

  const data = await response.json();
  const { confirmationUrl, userErrors } = data.data.appSubscriptionCreate;

  if (userErrors?.length > 0) {
    return json({ error: userErrors[0].message }, { status: 400 });
  }

  return redirect(confirmationUrl);
};

export default function Pricing() {
  const { plan, monthlyTryOns, monthlyLimit } = useLoaderData();
  const submit = useSubmit();

  const selectPlan = (planName) => {
    const fd = new FormData();
    fd.append("plan", planName);
    submit(fd, { method: "POST" });
  };

  return (
    <Page title="Choose Your Plan">
      <div style={{ padding: "0" }}>
        {/* Current plan banner */}
        <div style={{
          background: "#f0f7fb",
          border: "1px solid #94b8d0",
          borderRadius: "12px",
          padding: "16px 20px",
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          <div>
            <div style={{ fontSize: "13px", color: "#6b8fa8" }}>Current Plan</div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#1a2b3c", textTransform: "capitalize" }}>{plan || "Free"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "13px", color: "#6b8fa8" }}>Usage This Month</div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "#1a2b3c" }}>{monthlyTryOns} / {monthlyLimit}</div>
          </div>
        </div>

        {/* Plans grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "16px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          {PLANS.map((p) => {
            const isActive = (plan || "free") === p.name.toLowerCase();
            return (
              <div key={p.name} style={{
                border: isActive ? "2px solid #94b8d0" : "1px solid #e5e9ed",
                borderRadius: "16px",
                padding: "24px 20px",
                background: isActive ? "#f8fbfd" : "#fff",
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}>
                {p.tag && (
                  <div style={{
                    position: "absolute",
                    top: "-10px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#1a2b3c",
                    color: "#fff",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "4px 12px",
                    borderRadius: "10px",
                    letterSpacing: "0.5px",
                  }}>{p.tag}</div>
                )}

                <div style={{ fontSize: "18px", fontWeight: 700, color: "#1a2b3c", marginBottom: "4px" }}>{p.name}</div>

                <div style={{ marginBottom: "20px" }}>
                  <span style={{ fontSize: "32px", fontWeight: 800, color: "#1a2b3c" }}>
                    {p.price === 0 ? "Free" : `₹${p.price.toLocaleString()}`}
                  </span>
                  {p.price > 0 && <span style={{ fontSize: "13px", color: "#9cadb8" }}>/month</span>}
                </div>

                <div style={{ flex: 1, marginBottom: "20px" }}>
                  {p.features.map((f, i) => (
                    <div key={i} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      color: "#4a5e6d",
                      marginBottom: "8px",
                    }}>
                      <span style={{ color: "#5a9fb5", fontSize: "14px" }}>✓</span>
                      {f}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => !isActive && selectPlan(p.name)}
                  disabled={isActive}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "10px",
                    border: isActive ? "1px solid #94b8d0" : "none",
                    background: isActive ? "transparent" : "#1a2b3c",
                    color: isActive ? "#94b8d0" : "#fff",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: isActive ? "default" : "pointer",
                    fontFamily: "Inter, system-ui, sans-serif",
                  }}
                >
                  {isActive ? "Current Plan" : p.price === 0 ? "Downgrade" : "Upgrade"}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{
          textAlign: "center",
          fontSize: "12px",
          color: "#9cadb8",
          marginTop: "20px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          All paid plans include a 3-day free trial. Cancel anytime from Shopify admin.
        </div>
      </div>
    </Page>
  );
}
