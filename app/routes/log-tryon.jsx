import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Direct endpoint for logging try-on events from storefront
export const action = async ({ request }) => {
  // CORS headers for storefront requests
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers });
  }

  try {
    const formData = await request.formData();
    const shop = formData.get("shop");
    const productId = formData.get("product_id") || "";
    const productTitle = formData.get("product_title") || "";
    const event = formData.get("event");

    if (!shop) {
      return json({ error: "Missing shop" }, { status: 400, headers });
    }

    if (event === "atc") {
      // Log add-to-cart event
      await prisma.tryOnLog.create({
        data: { shop, productId, productTitle, resultUrl: "", status: "added_to_cart" },
      });
      return json({ success: true, event: "atc" }, { headers });
    }

    await prisma.shopSettings.upsert({
      where: { shop },
      update: { monthlyTryOns: { increment: 1 }, totalTryOns: { increment: 1 } },
      create: { shop, monthlyTryOns: 1, totalTryOns: 1, enabled: true },
    });

    await prisma.tryOnLog.create({
      data: { shop, productId, productTitle, resultUrl: "client-fallback", status: "completed" },
    });

    return json({ success: true }, { headers });
  } catch (e) {
    return json({ error: e.message }, { status: 500, headers });
  }
};

export const loader = async () => {
  return json({ status: "ok" }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
};
