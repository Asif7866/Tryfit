import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      // Clean up shop data if needed
      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};
