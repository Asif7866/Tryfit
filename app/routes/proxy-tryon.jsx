import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { fal } from "@fal-ai/client";

const prisma = new PrismaClient();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: CORS });
  }

  try {
    const formData = await request.formData();
    const productImageUrl = formData.get("product_image_url");
    const productTitle = formData.get("product_title") || "garment";
    const userPhotoFile = formData.get("user_photo");
    const category = formData.get("category") || "dresses";
    const shop = formData.get("shop");

    // Log-only mode
    const logOnly = formData.get("log_only");
    if (logOnly === "1" && shop) {
      try {
        await prisma.shopSettings.upsert({
          where: { shop },
          update: { monthlyTryOns: { increment: 1 }, totalTryOns: { increment: 1 } },
          create: { shop, monthlyTryOns: 1, totalTryOns: 1, enabled: true },
        });
        await prisma.tryOnLog.create({
          data: { shop, productId: formData.get("product_id") || "", productTitle: formData.get("product_title") || "", resultUrl: "client-fallback", status: "completed" },
        });
      } catch (e) {}
      return json({ success: true, logged: true }, { headers: CORS });
    }

    if (!productImageUrl || !userPhotoFile) {
      return json({ error: "Missing required fields" }, { status: 400, headers: CORS });
    }

    // Check try-on limits — skip for dev store
    const DEV_STORES = ["testing-ashif.myshopify.com"];
    if (shop && !DEV_STORES.includes(shop)) {
      try {
        const settings = await prisma.shopSettings.findUnique({ where: { shop } });
        if (settings && settings.monthlyTryOns >= settings.monthlyLimit) {
          return json({ error: "Monthly try-on limit reached. Please upgrade your plan." }, { status: 429, headers: CORS });
        }
      } catch (dbErr) {
        console.error("DB check skipped:", dbErr.message);
      }
    }

    const falKey = process.env.FAL_KEY;
    if (!falKey) {
      return json({ error: "AI not configured" }, { status: 503, headers: CORS });
    }

    // Configure fal.ai
    fal.config({ credentials: falKey });

    // Fix product image URL
    let garmImg = productImageUrl;
    if (garmImg.startsWith("//")) garmImg = "https:" + garmImg;

    // Upload user photo to fal.ai storage (they need URLs, not base64)
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const userBlob = new Blob([arrayBuffer], { type: userPhotoFile.type || "image/jpeg" });
    const userPhotoUrl = await fal.storage.upload(userBlob);

    console.log("Calling Kolors VTON v1.5 — human:", userPhotoUrl, "garment:", garmImg);

    // Kolors Virtual Try-On v1.5 via fal.ai ($0.07/run)
    // Same model as kolorsvirtual.com — best quality for Indian garments
    const result = await fal.subscribe("fal-ai/kling/v1-5/kolors-virtual-try-on", {
      input: {
        human_image_url: userPhotoUrl,
        garment_image_url: garmImg,
      },
    });

    const resultUrl = result.data?.image?.url;
    if (!resultUrl) {
      console.error("No result URL from fal.ai:", JSON.stringify(result));
      return json({ error: "AI returned no result" }, { status: 500, headers: CORS });
    }

    console.log("Kolors VTON success:", resultUrl);

    // Increment usage counter
    if (shop) {
      try {
        await prisma.shopSettings.update({
          where: { shop },
          data: {
            monthlyTryOns: { increment: 1 },
            totalTryOns: { increment: 1 },
          },
        });
        await prisma.tryOnLog.create({
          data: {
            shop,
            productId: formData.get("product_id") || "",
            productTitle,
            resultUrl: String(resultUrl),
            status: "completed",
          },
        });
      } catch (dbErr) {
        console.error("DB log skipped:", dbErr.message);
      }
    }

    return json({ success: true, result_url: String(resultUrl) }, { headers: CORS });

  } catch (error) {
    console.error("Try-on error:", error);
    return json({ error: "Try-on failed", details: error.message }, { status: 500, headers: CORS });
  }
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return json({ ok: true }, { headers: CORS });
};
