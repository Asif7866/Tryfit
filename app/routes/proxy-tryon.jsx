import { json } from "@remix-run/node";
import { fal } from "@fal-ai/client";
import { createHash } from "node:crypto";
import { prisma } from "../shopify.server";
import { ensureMonthlyReset, maybeSendUsageAlert } from "../lib/usage.server";
import { applyStudioBackground } from "../lib/studio.server";
import Jimp from "jimp";

// Nearest supported aspect ratio string for the room photo
async function roomAspect(buf) {
  try {
    const im = await Jimp.read(buf);
    const r = im.bitmap.width / im.bitmap.height;
    const opts = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16, "3:2": 1.5, "2:3": 2 / 3, "5:4": 1.25, "4:5": 0.8, "21:9": 21 / 9 };
    return Object.entries(opts).sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0];
  } catch (_) { return "auto"; }
}

// If output is noticeably taller/wider than the room photo, crop (top-anchored / centered) to the room's ratio and re-host
async function cropToRoomAspect(resultUrl, roomBuf) {
  const [out, room] = await Promise.all([Jimp.read(resultUrl), Jimp.read(roomBuf)]);
  const rr = room.bitmap.width / room.bitmap.height;
  const or = out.bitmap.width / out.bitmap.height;
  if (Math.abs(or - rr) / rr < 0.12) return resultUrl;
  let w = out.bitmap.width, h = out.bitmap.height, x = 0, y = 0;
  if (or < rr) { h = Math.round(w / rr); }
  else { w = Math.round(h * rr); x = Math.round((out.bitmap.width - w) / 2); }
  const buf = await out.crop(x, y, w, h).quality(92).getBufferAsync(Jimp.MIME_JPEG);
  return fal.storage.upload(new Blob([buf], { type: "image/jpeg" }));
}

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
    const mode = (formData.get("mode") || "fashion").toLowerCase() === "home" ? "home" : "fashion";
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
    const cacheKey = createHash("sha256").update(`${shop}|${garmImg}|${photoHash}|${studio ? "studio" : "raw"}|${(process.env.TRYON_MODEL || "kolors").toLowerCase()}|${mode}`).digest("hex");

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

    // Model switch: TRYON_MODEL=nano-banana | nano-banana-pro (Gemini via fal) | fashn (FASHN v1.6) | kolors (default)
    let model = (process.env.TRYON_MODEL || "kolors").toLowerCase();
    if (mode === "home") model = "nano-banana-pro"; // room placement needs a general image editor
    const runKolors = async () => {
      const r = await fal.subscribe("fal-ai/kling/v1-5/kolors-virtual-try-on", {
        input: { human_image_url: userPhotoUrl, garment_image_url: garmImg },
      });
      return r.data?.image?.url;
    };
    let resultUrl;
    if (model === "nano-banana" || model === "nano-banana-pro") {
      try {
        const r = await fal.subscribe(`fal-ai/${model}/edit`, {
          input: {
            prompt: mode === "home"
              ? `Home decor visualization. The first image is a customer's room. The second image shows a product: ${productTitle}. ` +
                "Place this exact product into the room on the correct surface — a bedsheet, comforter, duvet, quilt or dohar goes on the bed replacing the existing bedding; " +
                "pillow or cushion covers go on the existing pillows/cushions; a curtain hangs on the window; a rug lies on the floor; a throw drapes over the bed or sofa; " +
                "wall art, a frame or poster mounts on the wall; a tablecloth or runner covers the table. " +
                "Match the room's perspective, scale, lighting, shadows and natural fabric folds so it looks photographed in place. " +
                "Reproduce the product's color, print, pattern and texture exactly as in the second image. " +
                "Keep everything else in the room — furniture, walls, floor, objects, lighting — exactly unchanged. " +
                "Ignore any staging, room, box, pedestal or props in the second image; only take the product itself. " +
                "STRICT: the output must be the first image (the room) edited in place — identical framing, crop and aspect ratio as the first image. " +
                "Never append, stack, tile or show the second image or any part of it. Output exactly one photorealistic image."
              : `Virtual try-on. Dress the person in the first image in the exact garment shown in the second image (${productTitle}). ` +
                "Keep the person's face, skin tone, hair, body shape, pose, and background exactly unchanged. " +
                "Reproduce the garment's color, print, pattern, fabric texture, border, embroidery, and drape exactly as in the second image. " +
                "Ignore any model or background in the second image. Output one photorealistic image.",
            image_urls: [userPhotoUrl, garmImg],
            num_images: 1,
            output_format: "jpeg",
            ...(mode === "home" ? { aspect_ratio: await roomAspect(userBuffer) } : {}),
          },
        });
        resultUrl = r.data?.images?.[0]?.url;
      } catch (e) {
        console.error(`${model} failed, falling back to kolors:`, e.message);
      }
      if (!resultUrl && mode !== "home") resultUrl = await runKolors();
    } else if (model === "fashn") {
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
      resultUrl = await runKolors();
    }
    const result = { data: { image: { url: resultUrl } } };
    if (!resultUrl) {
      console.error("No result from fal.ai:", JSON.stringify(result));
      return json({ error: "AI returned no result" }, { status: 500, headers: CORS });
    }

    // Home mode safety net: if the model stitched the product photo below the room, crop back to the room's aspect ratio
    if (mode === "home") {
      try { resultUrl = await cropToRoomAspect(resultUrl, userBuffer); } catch (e) { console.error("room crop skipped:", e.message); }
    }

    // Optional: studio backdrop matching the product photo (merchant toggle)
    if (studio && mode !== "home") {
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
