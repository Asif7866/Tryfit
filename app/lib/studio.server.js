import Jimp from "jimp";
import { fal } from "@fal-ai/client";

/**
 * Replace the background of a try-on result with a studio backdrop
 * whose tone matches the product photo. Returns a hosted URL.
 */
export async function applyStudioBackground(resultUrl, productImageUrl) {
  // 1. Cut out the person (PNG with alpha)
  const cut = await fal.subscribe("fal-ai/birefnet", {
    input: { image_url: resultUrl, model: "General Use (Light)", operating_resolution: "1024x1024", output_format: "png" },
  });
  const cutUrl = cut?.data?.image?.url;
  if (!cutUrl) throw new Error("birefnet returned no image");

  const [person, product] = await Promise.all([Jimp.read(cutUrl), Jimp.read(productImageUrl)]);
  const W = person.bitmap.width, H = person.bitmap.height;

  // 2. Sample product photo border to get backdrop tone
  const pw = product.bitmap.width, ph = product.bitmap.height;
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.min(pw, ph) / 60));
  const band = Math.max(4, Math.floor(Math.min(pw, ph) * 0.08));
  for (let y = 0; y < ph; y += step) {
    for (let x = 0; x < pw; x += step) {
      const edge = x < band || x > pw - band || y < band;
      if (!edge) continue;
      const c = Jimp.intToRGBA(product.getPixelColor(x, y));
      r += c.r; g += c.g; b += c.b; n++;
    }
  }
  if (n === 0) { r = 200; g = 190; b = 170; n = 1; }
  r /= n; g /= n; b /= n;

  // 3. Build backdrop: vertical gradient + soft vignette + floor shadow
  const bg = new Jimp(W, H, 0xffffffff);
  const cx = W / 2, cy = H * 0.55, maxD = Math.hypot(cx, cy);
  bg.scan(0, 0, W, H, function (x, y, idx) {
    const t = y / H;                                  // 0 top → 1 bottom
    const light = 1.08 - t * 0.22;                    // lighter top, darker bottom
    const d = Math.hypot(x - cx, y - cy) / maxD;      // vignette
    const vig = 1 - Math.pow(d, 2.2) * 0.18;
    let k = light * vig;
    // floor shadow ellipse under the subject
    const sx = (x - cx) / (W * 0.28), sy = (y - H * 0.93) / (H * 0.035);
    const e = sx * sx + sy * sy;
    if (e < 1) k *= 1 - (1 - e) * 0.25;
    this.bitmap.data[idx] = Math.max(0, Math.min(255, r * k));
    this.bitmap.data[idx + 1] = Math.max(0, Math.min(255, g * k));
    this.bitmap.data[idx + 2] = Math.max(0, Math.min(255, b * k));
    this.bitmap.data[idx + 3] = 255;
  });

  // 4. Composite cutout
  bg.composite(person, 0, 0);
  const out = await bg.quality(92).getBufferAsync(Jimp.MIME_JPEG);

  // 5. Host
  const url = await fal.storage.upload(new Blob([out], { type: "image/jpeg" }));
  return url;
}
