import { json } from "@remix-run/node";
import { fal } from "@fal-ai/client";
import { createHash } from "node:crypto";
import { prisma } from "../shopify.server";
import { ensureMonthlyReset, maybeSendUsageAlert } from "../lib/usage.server";
import { applyStudioBackground } from "../lib/studio.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEV_STORES = ["testing-ashif.myshopify.com"];
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, headers: CORS });

  try {
    const formData = await request.formData();
    const productImageUrl = formData.get("product_image_url");
    const productTitle = formData.get("product_title") || "garment";
    const productId = formData.get("product_id") || "";
    const userPhotoFile = formData.get("user_photo");
    const shop = formData.get("shop");

    // Log-only mode (client fallback tracking)
    if (formData.get("log_only") === "1" && shop) {
      try {
        await prisma.shopSettings.upsert({
          where: { shop },
          update: { monthlyTryOns: { increment: 1 }, totalTryOns: { increment: 1 } },
          create: { shop, monthlyTryOns: 1, totalTryOns: 1, enabled: true },
        });
        await prisma.tryOnLog.create({ data: { shop, productId, productTitle, resultUrl: "client-fallback", status: "completed" } });
      } catch (e) {}
      return json({ success: true, logged: true }, { headers: CORS });
    }

    if (!productImageUrl || !userPhotoFile || !shop) {
      return json({ error: "Missing required fields" }, { status: 400, headers: CORS });
    }

    // Lazy monthly reset + limit check
    const isDev = DEV_STORES.includes(shop);
    let settings = null;
    try {
      settings = await ensureMonthlyReset(shop);
      if (settings) {
        const disabled = Array.isArray(settings.disabledProducts) ? settings.disabledProducts : [];
        if (disabled.includes(String(productId))) {
          return json({ error: "Try-on is not available for this product." }, { status: 403, headers: CORS });
        }
        if (!isDev && settings.monthlyTryOns >= settings.monthlyLimit) {
          return json({ error: "Monthly try-on limit reached. Please upgrade your plan." }, { status: 429, headers: CORS });
        }
      }
    } catch (dbErr) {
      console.error("DB check skipped:", dbErr.message);
    }

    const falKey = process.env.FAL_KEY;
    if (!falKey) return json({ error: "AI not configured" }, { status: 503, headers: CORS });

    let garmImg = productImageUrl;
    if (garmImg.startsWith("//")) garmImg = "https:" + garmImg;

    // Cache key = shop + garment URL + user photo bytes hash
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const userBuffer = Buffer.from(arrayBuffer);
    const photoHash = createHash("sha256").update(userBuffer).digest("hex");
    const studio = settings?.studioBackground === true;
    const cacheKey = createHash("sha256").update(`${shop}|${garmImg}|${photoHash}|${studio ? "studio" : "raw"}|${(process.env.TRYON_MODEL || "kolors").toLowerCase()}`).digest("hex");

    // Cache hit → instant, free, not counted against quota
    try {
      const hit = await prisma.tryOnCache.findUnique({ where: { cacheKey } });
      if (hit && Date.now() - new Date(hit.createdAt).getTime() < CACHE_TTL_MS) {
        return json({ success: true, result_url: hit.resultUrl, cached: true }, { headers: CORS });
      }
    } catch (e) {}

    // Kolors VTON v1.5 via fal.ai
    fal.config({ credentials: falKey });
    const userBlob = new Blob([userBuffer], { type: userPhotoFile.type || "image/jpeg" });
    const userPhotoUrl = await fal.storage.upload(userBlob);

    // Model switch: TRYON_MODEL=fashn (FASHN v1.6, better for on-model/multi-layer garments) | default kolors
    const model = (process.env.TRYON_MODEL || "kolors").toLowerCase();
    let resultUrl;
    if (model === "fashn") {
      const catMap = { upper_body: "tops", lower_body: "bottoms", dresses: "one-pieces" };
      const r = await fal.subscribe("fal-ai/fashn/tryon/v1.6", {
        input: {
          model_image: userPhotoUrl,
          garment_image: garmImg,
          category: catMap[formData.get("category")] || "auto",
          mode: "quality",
          garment_photo_type: "model",
          num_samples: 1,
        },
      });
      resultUrl = r.data?.images?.[0]?.url;
    } else {
      const r = await fal.subscribe("fal-ai/kling/v1-5/kolors-virtual-try-on", {
        input: { human_image_url: userPhotoUrl, garment_image_url: garmImg },
      });
      resultUrl = r.data?.image?.url;
    }
    const result = { data: { image: { url: resultUrl } } };
    if (!resultUrl) {
      console.error("No result from fal.ai:", JSON.stringify(result));
      return json({ error: "AI returned no result" }, { status: 500, headers: CORS });
    }

    // Optional: studio backdrop matching the product photo (merchant toggle)
    if (studio) {
      try {
        resultUrl = await applyStudioBackground(resultUrl, garmImg);
      } catch (bgErr) {
        console.error("Studio background failed, using raw result:", bgErr.message);
      }
    }

    // Persist cache (independent — must never block usage logging)
    try {
      await prisma.tryOnCache.upsert({
        where: { cacheKey },
        update: { resultUrl, createdAt: new Date() },
        create: { shop, cacheKey, resultUrl },
      });
    } catch (cacheErr) {
      console.error("Cache write skipped:", cacheErr.message);
    }

    // Usage + log
    try {
      await prisma.shopSettings.upsert({
        where: { shop },
        update: { monthlyTryOns: { increment: 1 }, totalTryOns: { increment: 1 } },
        create: { shop, monthlyTryOns: 1, totalTryOns: 1, enabled: true, lastResetAt: new Date() },
      });
      await prisma.tryOnLog.create({
        data: { shop, productId, productTitle, resultUrl: String(resultUrl), status: "completed" },
      });
    } catch (dbErr) {
      console.error("DB log skipped:", dbErr.message);
    }

    // 80% usage email (fire-and-forget)
    if (!isDev) maybeSendUsageAlert(shop).catch(() => {});

    return json({ success: true, result_url: String(resultUrl) }, { headers: CORS });
  } catch (error) {
    console.error("Try-on error:", error);
    return json({ error: "Try-on failed", details: error.message }, { status: 500, headers: CORS });
  }
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return json({ ok: true }, { headers: CORS });
};
