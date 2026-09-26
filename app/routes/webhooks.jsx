import { authenticate, prisma } from "../shopify.server";

const ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      await prisma.shopSettings.deleteMany({ where: { shop } });
      await prisma.session.deleteMany({ where: { shop } });
      break;

    case "ORDERS_CREATE": {
      // Attribute order to try-on if the product was tried on within the window
      try {
        const orderId = String(payload?.id || "");
        const items = Array.isArray(payload?.line_items) ? payload.line_items : [];
        const since = new Date(Date.now() - ATTRIBUTION_WINDOW_MS);
        for (const li of items) {
          const pid = String(li.product_id || "");
          if (!pid) continue;
          const tried = await prisma.tryOnLog.findFirst({
            where: { shop, productId: pid, status: { in: ["completed", "added_to_cart"] }, createdAt: { gte: since } },
            orderBy: { createdAt: "desc" },
          });
          if (!tried) continue;
          const already = await prisma.tryOnLog.findFirst({ where: { shop, orderId, productId: pid, status: "converted" } });
          if (already) continue;
          const revenue = parseFloat(li.price || 0) * (parseInt(li.quantity || 1, 10) || 1);
          await prisma.tryOnLog.create({
            data: { shop, productId: pid, productTitle: li.title || tried.productTitle || "", resultUrl: "", status: "converted", orderId, revenue },
          });
        }
      } catch (e) {
        console.error("ORDERS_CREATE attribution failed:", e.message);
      }
      break;
    }

    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break;

    case "SHOP_REDACT":
      await prisma.tryOnLog.deleteMany({ where: { shop } });
      await prisma.tryOnCache.deleteMany({ where: { shop } });
      await prisma.shopSettings.deleteMany({ where: { shop } });
      break;

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};
