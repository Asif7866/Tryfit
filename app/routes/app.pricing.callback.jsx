import { redirect } from "@remix-run/node";
import shopify from "../shopify.server";
import { prisma } from "../shopify.server";

const PLAN_LIMITS = {
  free: 10,
  starter: 200,
  growth: 600,
  pro: 2000,
};

export const loader = async ({ request }) => {
  try {
    const { session } = await shopify.authenticate.admin(request);
    const shop = session.shop;
    const url = new URL(request.url);
    const plan = url.searchParams.get("plan")?.toLowerCase() || "free";
    const chargeId = url.searchParams.get("charge_id");

    if (chargeId) {
      await prisma.shopSettings.upsert({
        where: { shop },
        update: {
          plan,
          monthlyLimit: PLAN_LIMITS[plan] || 10,
          billingId: chargeId,
        },
        create: {
          shop,
          plan,
          monthlyLimit: PLAN_LIMITS[plan] || 10,
          billingId: chargeId,
        },
      });
    }
  } catch (e) {
    console.error("Billing callback error:", e);
  }

  return redirect("/app/pricing");
};
