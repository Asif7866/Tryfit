import { authenticate } from "../shopify.server";
import { prisma } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      // Clean up shop data
      await prisma.shopSettings.deleteMany({ where: { shop } });
      await prisma.session.deleteMany({ where: { shop } });
      break;
    case "CUSTOMERS_DATA_REQUEST":
      // We don't store customer data — only shop-level try-on logs
      break;
    case "CUSTOMERS_REDACT":
      // We don't store customer PII — nothing to redact
      break;
    case "SHOP_REDACT":
      // Delete all shop data
      await prisma.tryOnLog.deleteMany({ where: { shop } });
      await prisma.shopSettings.deleteMany({ where: { shop } });
      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};
