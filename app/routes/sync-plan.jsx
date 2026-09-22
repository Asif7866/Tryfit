import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PLAN_LIMITS = { "free": 10, "starter": 100, "growth": 400, "pro": 1200 };

// POST /sync-plan  { shop, plan }
// Called after merchant upgrades plan — syncs DB so dashboard fallback shows correct data
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS });
  }

  try {
    const body = await request.json();
    const { shop, plan } = body;

    if (!shop || !plan) {
      return json({ error: "Missing shop or plan" }, { status: 400, headers: CORS });
    }

    const planKey = plan.toLowerCase();
    const monthlyLimit = PLAN_LIMITS[planKey] || 10;

    await prisma.shopSettings.upsert({
      where: { shop },
      update: { plan: planKey, monthlyLimit },
      create: { shop, plan: planKey, monthlyLimit, enabled: true },
    });

    return json({ success: true, plan: planKey, monthlyLimit }, { headers: CORS });
  } catch (error) {
    return json({ error: error.message }, { status: 500, headers: CORS });
  }
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return json({ ok: true }, { headers: CORS });
};
