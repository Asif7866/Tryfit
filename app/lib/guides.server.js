import { fal } from "@fal-ai/client";
import { prisma } from "../shopify.server";

/**
 * Photo-guide images for the storefront drawer (✓ / ✗ examples).
 * Generated once with AI (no real people), cached in DB, then served as a redirect to the CDN image.
 * Bump VERSION to regenerate.
 */
const VERSION = "v1";
const BASE = "Photorealistic photograph, natural skin texture, realistic lighting, high detail, no text, no watermark, no logo.";
const PROMPTS = {
  full: `${BASE} Full-length studio photo of a young South Asian woman standing straight and facing the camera, arms relaxed at her sides, wearing a plain fitted charcoal top, light-blue straight-leg jeans and white sneakers. Her entire body is visible from the top of her head to her feet with space above and below. Plain warm light-grey seamless backdrop, soft even studio light.`,
  group: `${BASE} Candid photo of two young women friends hugging cheek to cheek and laughing, framed from the waist up, wearing casual white and pastel tops, bright soft daylight, plain light background.`,
  selfie: `${BASE} Close-up smartphone selfie of a smiling young woman with long dark hair, only her face and shoulders in frame, wearing a pastel striped knit sweater, soft indoor window light.`,
  room: `${BASE} Wide eye-level interior photo of a bright, minimal modern bedroom showing the entire double bed with plain white bedding, the headboard, bedside table and some floor visible. Soft natural daylight, neutral warm tones.`,
  closeup: `${BASE} Extreme close-up of white cotton bed-sheet fabric with soft folds filling the entire frame, no furniture visible.`,
  dark: `${BASE} Dim, underexposed, slightly grainy smartphone photo of a bedroom at night, the bed barely visible in the shadows, a small lamp glowing faintly.`,
  sfull: `${BASE} Full-length photo of a young woman standing on a light wooden floor facing the camera, feet slightly apart, wearing simple straight-leg cream trousers ending above the ankles and plain white sneakers, both feet and shoes fully visible and sharp, plain warm light-grey wall behind, soft daylight.`,
  scrop: `${BASE} Photo of a person's legs where the bottom of the frame cuts off the feet at the ankles so no shoes are visible, wearing jeans, plain floor and wall, soft light.`,
  jportrait: `${BASE} Front-facing chest-up portrait of a young South Asian woman looking at the camera with a soft smile, hair neatly tied back so her neck, collarbones and both ears are clearly visible, wearing a plain off-shoulder top in a muted beige, no jewelry, plain warm light-grey backdrop, soft beauty lighting.`,
  jfar: `${BASE} Distant full-length photo of a woman standing far away in a park, very small in the frame, her neck and face too small to see details.`,
  jcovered: `${BASE} Side-profile photo of a young woman with long loose hair falling over her neck and covering her ears, wearing a high-neck winter sweater and scarf, soft indoor light.`,
};

const inflight = new Map();
export const GUIDE_NAMES = Object.keys(PROMPTS);

async function _generate(name) {
  const key = `guide:${VERSION}:${name}`;
  const hit = await prisma.tryOnCache.findUnique({ where: { cacheKey: key } }).catch(() => null);
  if (hit?.resultUrl) return hit.resultUrl;
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("FAL_KEY missing");
  fal.config({ credentials: falKey });
  let url = null;
  try {
    const r = await fal.subscribe("fal-ai/nano-banana-pro", { input: { prompt: PROMPTS[name], aspect_ratio: "3:4", num_images: 1, output_format: "jpeg" } });
    url = r?.data?.images?.[0]?.url;
  } catch (e) {
    console.error("[guide] nano-banana-pro failed, falling back:", name, e?.message);
  }
  if (!url) {
    const r = await fal.subscribe("fal-ai/flux/dev", { input: { prompt: PROMPTS[name], image_size: "portrait_4_3", num_images: 1 } });
    url = r?.data?.images?.[0]?.url;
  }
  if (!url) throw new Error("no image");
  await prisma.tryOnCache.upsert({
    where: { cacheKey: key },
    update: { resultUrl: url },
    create: { shop: "__tryfit__", cacheKey: key, resultUrl: url },
  });
  return url;
}

export function getGuide(name) {
  if (!PROMPTS[name]) return Promise.reject(new Error("unknown guide"));
  if (!inflight.has(name)) inflight.set(name, _generate(name).finally(() => inflight.delete(name)));
  return inflight.get(name);
}

/** Pre-generate all guide images at boot so no shopper waits for the first render. */
export async function warmGuides() {
  for (const n of GUIDE_NAMES) await getGuide(n).catch((e) => console.error("[guide] warm", n, e?.message));
}
