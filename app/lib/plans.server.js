import shopify from "../shopify.server";
import { prisma } from "../shopify.server";

export const PLAN_LIMITS = { free: 10, starter: 100, growth: 300, pro: 700 };
export const planKeyFromName = (name) => {
  const k = String(name || "free").toLowerCase().trim();
  return PLAN_LIMITS[k] !== undefined ? k : "free";
};

/** Apply a plan to a shop's DB row (name from Shopify subscription). */
export async function applyPlan(shop, planName, { chosen = true } = {}) {
  const planKey = planKeyFromName(planName);
  const monthlyLimit = PLAN_LIMITS[planKey];
  return prisma.shopSettings.upsert({
    where: { shop },
    update: { plan: planKey, monthlyLimit, usageAlertSent: false, ...(chosen ? { planChosen: true } : {}) },
    create: { shop, plan: planKey, monthlyLimit, enabled: true, planChosen: chosen, lastResetAt: new Date() },
  });
}

/**
 * Re-sync plan from Shopify using the stored offline session (no admin UI needed).
 * Returns the fresh settings row, or null if the shop has no usable session.
 */
export async function syncPlanFromShopify(shop) {
  try {
    const { admin } = await shopify.unauthenticated.admin(shop);
    const res = await admin.graphql(`{ appInstallation { activeSubscriptions { name status } } }`);
    const data = await res.json();
    const subs = data.data?.appInstallation?.activeSubscriptions || [];
    const active = subs.find((s) => s.status === "ACTIVE");
    return applyPlan(shop, active?.name || "free", { chosen: !!active });
  } catch (e) {
    console.error("syncPlanFromShopify failed:", shop, e?.message || e);
    return null;
  }
}
