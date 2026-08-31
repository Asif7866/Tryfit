import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Webhook received: ${topic} for ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      try {
        await prisma.shopSettings.deleteMany({ where: { shop } });
        await prisma.session.deleteMany({ where: { shop } });
      } catch (e) {
        console.error("APP_UNINSTALLED cleanup error:", e.message);
      }
      break;

    case "CUSTOMERS_DATA_REQUEST":
      // TryFit does not store customer PII — only shop-level try-on logs
      // Return empty response to acknowledge
      return json({ data_request: "no_customer_data_stored" });

    case "CUSTOMERS_REDACT":
      // TryFit does not store customer PII — nothing to redact
      return json({ redacted: true });

    case "SHOP_REDACT":
      try {
        await prisma.tryOnLog.deleteMany({ where: { shop } });
        await prisma.shopSettings.deleteMany({ where: { shop } });
      } catch (e) {
        console.error("SHOP_REDACT cleanup error:", e.message);
      }
      return json({ redacted: true });

    default:
      console.warn(`Unhandled webhook topic: ${topic}`);
      return json({ error: "Unhandled webhook topic" }, { status: 404 });
  }

  return json({ success: true });
};
