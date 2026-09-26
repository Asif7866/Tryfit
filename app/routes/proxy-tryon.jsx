import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { Client } from "@gradio/client";

const prisma = new PrismaClient();

// Kolors Virtual Try-On via HuggingFace Space (FREE)
async function kolorsVTON(userPhotoDataUri, garmImgUrl) {
  const client = await Client.connect("Kwai-Kolors/Kolors-Virtual-Try-On");

  // Convert data URI to Blob for Gradio
  const base64Data = userPhotoDataUri.split(",")[1];
  const mimeMatch = userPhotoDataUri.match(/data:([^;]+);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const userBlob = new Blob([Buffer.from(base64Data, "base64")], { type: mime });

  // Download garment image and convert to Blob
  const garmRes = await fetch(garmImgUrl);
  if (!garmRes.ok) throw new Error("Failed to download garment image");
  const garmBuffer = await garmRes.arrayBuffer();
  const garmBlob = new Blob([garmBuffer], { type: "image/jpeg" });

  const result = await client.predict("/tryon", [
    userBlob,   // person image
    garmBlob,   // garment image
    0,          // seed
    true,       // randomize seed
  ]);

  // Result contains image URL from HuggingFace
  if (result?.data?.[0]?.url) {
    return result.data[0].url;
  }
  throw new Error("No result from Kolors");
}

// IDM-VTON via Replicate (FALLBACK — $0.05/run)
async function idmVTON(userPhotoDataUri, garmImgUrl, garmentDesc, category, token) {
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
        garm_img: garmImgUrl,
        garment_des: garmentDesc,
        category: category,
        is_checked: true,
        is_checked_crop: true,
        denoise_steps: 40,
      },
    }),
  });

  const prediction = await createRes.json();
  if (!createRes.ok) throw new Error(prediction.detail || "Replicate error");

  let result = prediction;
  const getUrl = result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`;

  for (let i = 0; i < 60; i++) {
    if (result.status === "succeeded") break;
    if (result.status === "failed" || result.status === "canceled") {
      throw new Error("AI generation failed");
    }
    await new Promise(r => setTimeout(r, 1000));
    const pollRes = await fetch(getUrl, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    result = await pollRes.json();
  }

  if (result.status !== "succeeded") throw new Error("AI timeout");
  return Array.isArray(result.output) ? result.output[0] : result.output;
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

    // Convert uploaded file to base64 data URI
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = userPhotoFile.type || "image/jpeg";
    const userPhotoDataUri = `data:${mimeType};base64,${base64}`;

    // Fix product image URL (Shopify returns protocol-relative URLs)
    let garmImg = productImageUrl;
    if (garmImg.startsWith("//")) garmImg = "https:" + garmImg;

    // Better garment description based on category
    const categoryDescMap = {
      "upper_body": "upper body garment, top, shirt, blouse, jacket",
      "lower_body": "lower body garment, pants, trousers, skirt, lehenga",
      "dresses": "full body outfit, dress, suit, kurta set, co-ord set, jumpsuit"
    };
    const garmentDesc = productTitle + ", " + (categoryDescMap[category] || categoryDescMap["dresses"]);

    // DUAL PROVIDER: Kolors (FREE via HuggingFace) → IDM-VTON (Replicate $0.05 fallback)
    let resultUrl;
    let provider = "kolors";

    try {
      console.log("Trying Kolors Virtual Try-On (HuggingFace)...");
      resultUrl = await kolorsVTON(userPhotoDataUri, garmImg);
      console.log("Kolors succeeded");
    } catch (kolorsErr) {
      console.error("Kolors failed:", kolorsErr.message, "— falling back to IDM-VTON");
      provider = "idm-vton";
      try {
        resultUrl = await idmVTON(userPhotoDataUri, garmImg, garmentDesc, category, token);
        console.log("IDM-VTON fallback succeeded");
      } catch (replicateErr) {
        console.error("IDM-VTON also failed:", replicateErr.message);
        return json({ error: "AI generation failed" }, { status: 500, headers: CORS });
      }
    }

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

    return json({ success: true, result_url: String(resultUrl), provider }, { headers: CORS });

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
