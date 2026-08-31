import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../shopify.server";

const PLAN_LIMITS = {
  free: 10,
  starter: 200,
  growth: 600,
  pro: 2000,
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
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

  return redirect("/app/pricing");
};
