import { json } from "@remix-run/node";
import Replicate from "replicate";
import { prisma } from "../shopify.server";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// POST /apps/tryon - called from storefront via app proxy
export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const shop = formData.get("shop");
    const productId = formData.get("product_id");
    const productTitle = formData.get("product_title");
    const productImageUrl = formData.get("product_image_url");
    const userPhotoFile = formData.get("user_photo");

    if (!shop || !productImageUrl || !userPhotoFile) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check shop settings
    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
    });

    if (!settings || !settings.enabled) {
      return json({ error: "Try-on is not enabled for this store" }, { status: 403 });
    }

    // Check monthly limit
    if (settings.monthlyLimit > 0) {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const monthCount = await prisma.tryOnLog.count({
        where: { shop, createdAt: { gte: monthStart } },
      });

      if (monthCount >= settings.monthlyLimit) {
        return json({ error: "Monthly try-on limit reached" }, { status: 429 });
      }
    }

    // Create log entry
    const log = await prisma.tryOnLog.create({
      data: {
        shop,
        productId: productId || "unknown",
        productTitle: productTitle || null,
        status: "processing",
      },
    });

    // Convert uploaded file to base64 data URI
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = userPhotoFile.type || "image/jpeg";
    const userPhotoDataUri = `data:${mimeType};base64,${base64}`;

    // Call Replicate - fashn-ai/tryon
    const output = await replicate.run("fashn-ai/tryon", {
      input: {
        model_image: userPhotoDataUri,
        garment_image: productImageUrl,
        category: "auto",
        flat_lay: false,
        adjust_hands: true,
        restore_background: true,
        restore_clothes: true,
      },
    });

    // output is typically an image URL
    const resultUrl = Array.isArray(output) ? output[0] : output;

    // Update log
    await prisma.tryOnLog.update({
      where: { id: log.id },
      data: { status: "completed", resultUrl: String(resultUrl) },
    });

    // Increment total
    await prisma.shopSettings.update({
      where: { shop },
      data: { totalTryOns: { increment: 1 } },
    });

    return json({
      success: true,
      result_url: String(resultUrl),
    });
  } catch (error) {
    console.error("Try-on error:", error);

    return json(
      { error: "Try-on failed. Please try again.", details: error.message },
      { status: 500 }
    );
  }
};

// GET /apps/tryon/settings - storefront fetches shop config
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Missing shop" }, { status: 400 });
  }

  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  if (!settings) {
    return json({
      enabled: false,
      buttonText: "Try The Look",
      buttonColor: "#000000",
      buttonTextColor: "#FFFFFF",
      modalTitle: "Ready to try this on?",
    });
  }

  return json({
    enabled: settings.enabled,
    buttonText: settings.buttonText,
    buttonColor: settings.buttonColor,
    buttonTextColor: settings.buttonTextColor,
    modalTitle: settings.modalTitle,
  });
};
