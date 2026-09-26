import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

const prisma = new PrismaClient();

// Preprocess image: resize to target dimensions with white background padding (maintains aspect ratio)
async function preprocessImage(buffer, targetSize = 1024) {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const { width, height } = meta;

  // Calculate resize dimensions maintaining aspect ratio
  const scale = Math.min(targetSize / width, targetSize / height);
  const resizedW = Math.round(width * scale);
  const resizedH = Math.round(height * scale);

  // Resize then pad to exact target with white background
  const processed = await sharp(buffer)
    .resize(resizedW, resizedH, { fit: "inside", withoutEnlargement: false })
    .extend({
      top: Math.floor((targetSize - resizedH) / 2),
      bottom: Math.ceil((targetSize - resizedH) / 2),
      left: Math.floor((targetSize - resizedW) / 2),
      right: Math.ceil((targetSize - resizedW) / 2),
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .jpeg({ quality: 95 })
    .toBuffer();

  return `data:image/jpeg;base64,${processed.toString("base64")}`;
}

// Download image URL to buffer
async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

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

    // Convert uploaded file to buffer then preprocess
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const userBuffer = Buffer.from(arrayBuffer);

    // Fix product image URL (Shopify returns protocol-relative URLs)
    let garmImg = productImageUrl;
    if (garmImg.startsWith("//")) garmImg = "https:" + garmImg;

    // PREPROCESSING: resize both images to 1024x1024 with white padding
    // This fixes: feet cutoff, edge artifacts, body proportion issues
    let userPhotoDataUri, garmImgDataUri;
    try {
      [userPhotoDataUri, garmImgDataUri] = await Promise.all([
        preprocessImage(userBuffer, 1024),
        downloadImage(garmImg).then(buf => preprocessImage(buf, 1024)),
      ]);
    } catch (preprocessErr) {
      console.error("Preprocessing failed, using raw images:", preprocessErr.message);
      // Fallback to raw images if preprocessing fails
      const base64 = userBuffer.toString("base64");
      const mimeType = userPhotoFile.type || "image/jpeg";
      userPhotoDataUri = `data:${mimeType};base64,${base64}`;
      garmImgDataUri = garmImg; // use original URL
    }

    // Better garment description based on category
    const categoryDescMap = {
      "upper_body": "upper body garment, top, shirt, blouse, jacket",
      "lower_body": "lower body garment, pants, trousers, skirt, lehenga",
      "dresses": "full body outfit, dress, suit, kurta set, co-ord set, jumpsuit"
    };
    const garmentDesc = productTitle + ", " + (categoryDescMap[category] || categoryDescMap["dresses"]);

    // Create prediction via Replicate API — with optimized params
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
        input: {
          human_img: userPhotoDataUri,
          garm_img: garmImgDataUri,
          garment_des: garmentDesc,
          category: category,
          is_checked_crop: true,
          denoise_steps: 40,
        },
      }),
    });

    const prediction = await createRes.json();
    
    if (!createRes.ok) {
      console.error("Replicate create error:", JSON.stringify(prediction));
      return json({ error: prediction.detail || "AI model error" }, { status: 500, headers: CORS });
    }

    // Poll for result
    let result = prediction;
    const getUrl = result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`;
    
    for (let i = 0; i < 60; i++) {
      if (result.status === "succeeded") break;
      if (result.status === "failed" || result.status === "canceled") {
        return json({ error: "AI generation failed" }, { status: 500, headers: CORS });
      }
      
      await new Promise(r => setTimeout(r, 1000));
      
      const pollRes = await fetch(getUrl, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      result = await pollRes.json();
    }

    if (result.status !== "succeeded") {
      return json({ error: "AI timeout" }, { status: 504, headers: CORS });
    }

    const resultUrl = Array.isArray(result.output) ? result.output[0] : result.output;

    // Increment usage counter (non-blocking)
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
  // Belt-and-suspenders: handle OPTIONS here too in case adapter routes it to loader
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return json({ ok: true }, { headers: CORS });
};
