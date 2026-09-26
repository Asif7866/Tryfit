import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// CORS: allow direct storefront calls (bypasses Shopify proxy 30s timeout)
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

    // Log-only mode: just record the try-on event (for client-side fallback tracking)
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

    // Check try-on limits (non-blocking) — skip for dev store
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

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return json({ error: "AI not configured" }, { status: 503, headers: CORS });
    }

    // Convert uploaded file (customer selfie) to base64 data URI
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = userPhotoFile.type || "image/jpeg";
    const userPhotoDataUri = `data:${mimeType};base64,${base64}`;

    // Fix product image URL (Shopify returns protocol-relative URLs)
    let productImg = productImageUrl;
    if (productImg.startsWith("//")) productImg = "https:" + productImg;

    // FACE SWAP approach:
    // input_image = product photo (model wearing garment) — face gets REPLACED
    // swap_image = customer's selfie — their face goes ON the product model
    // Result: garment stays 100% identical, only face changes
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34",
        input: {
          input_image: productImg,
          swap_image: userPhotoDataUri,
        },
      }),
    });

    const prediction = await createRes.json();

    if (!createRes.ok) {
      console.error("Replicate create error:", JSON.stringify(prediction));
      return json({ error: prediction.detail || "AI model error" }, { status: 500, headers: CORS });
    }

    // Poll for result — 120s timeout (cold starts can take 30-40s before processing begins)
    let result = prediction;
    const getUrl = result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`;

    for (let i = 0; i < 120; i++) {
      if (result.status === "succeeded") break;
      if (result.status === "failed" || result.status === "canceled") {
        console.error("Face swap failed:", result.error || result.logs);
        return json({ error: "AI generation failed: " + (result.error || "unknown") }, { status: 500, headers: CORS });
      }

      await new Promise(r => setTimeout(r, 1000));

      const pollRes = await fetch(getUrl, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      result = await pollRes.json();
    }

    if (result.status !== "succeeded") {
      console.error("Face swap timeout after 120s, last status:", result.status);
      return json({ error: "AI timeout — please try again" }, { status: 504, headers: CORS });
    }

    // Handle output — can be string URL or file object
    let resultUrl = result.output;
    if (typeof resultUrl === "object" && resultUrl !== null) {
      resultUrl = resultUrl.url || resultUrl[0]?.url || resultUrl[0] || String(resultUrl);
    }

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
