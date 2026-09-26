import Jimp from "jimp";
import { fal } from "@fal-ai/client";

const OUT_W = 768, OUT_H = 1024;

/**
 * Studio composite:
 *  - cutout via birefnet
 *  - auto-crop to subject and scale to fill frame like a product shot
 *  - backdrop = product photo itself, heavily blurred (keeps real tone/texture/vignette)
 *  - feathered edges + soft contact shadow
 */
export async function applyStudioBackground(resultUrl, productImageUrl) {
  const cut = await fal.subscribe("fal-ai/birefnet", {
    input: { image_url: resultUrl, model: "General Use (Light)", operating_resolution: "1024x1024", output_format: "png" },
  });
  const cutUrl = cut?.data?.image?.url;
  if (!cutUrl) throw new Error("birefnet returned no image");

  const [personRaw, product] = await Promise.all([Jimp.read(cutUrl), Jimp.read(productImageUrl)]);

  // ---- 1. Subject bbox → crop with headroom → scale to frame
  const pw = personRaw.bitmap.width, ph = personRaw.bitmap.height;
  let minX = pw, minY = ph, maxX = 0, maxY = 0;
  personRaw.scan(0, 0, pw, ph, function (x, y, idx) {
    if (this.bitmap.data[idx + 3] > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  });
  if (maxX <= minX || maxY <= minY) { minX = 0; minY = 0; maxX = pw - 1; maxY = ph - 1; }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const padX = Math.round(bw * 0.28), padTop = Math.round(bh * 0.07), padBot = Math.round(bh * 0.05);
  let cx0 = Math.max(0, minX - padX), cy0 = Math.max(0, minY - padTop);
  let cw = Math.min(pw - cx0, bw + padX * 2), ch = Math.min(ph - cy0, bh + padTop + padBot);
  // enforce 3:4 crop around subject
  const target = OUT_W / OUT_H;
  if (cw / ch > target) { const nh = Math.round(cw / target); cy0 = Math.max(0, Math.min(ph - nh, cy0 - Math.round((nh - ch) / 2))); ch = Math.min(nh, ph - cy0); }
  else { const nw = Math.round(ch * target); cx0 = Math.max(0, Math.min(pw - nw, cx0 - Math.round((nw - cw) / 2))); cw = Math.min(nw, pw - cx0); }
  const person = personRaw.clone().crop(cx0, cy0, cw, ch).resize(OUT_W, OUT_H, Jimp.RESIZE_BICUBIC);

  // ---- 2. Feather alpha edges (blur alpha only, no color halo)
  const alpha = new Jimp(OUT_W, OUT_H, 0x000000ff);
  person.scan(0, 0, OUT_W, OUT_H, function (x, y, idx) {
    const a = this.bitmap.data[idx + 3];
    const i = alpha.getPixelIndex(x, y);
    alpha.bitmap.data[i] = a; alpha.bitmap.data[i + 1] = a; alpha.bitmap.data[i + 2] = a;
  });
  alpha.blur(1);
  person.scan(0, 0, OUT_W, OUT_H, function (x, y, idx) {
    const i = alpha.getPixelIndex(x, y);
    this.bitmap.data[idx + 3] = Math.min(this.bitmap.data[idx + 3], alpha.bitmap.data[i]);
  });

  // ---- 3. Backdrop: blurred product photo (cover-fit), slight bottom darkening
  const small = product.clone().cover(192, 256).blur(14);
  const bg = small.resize(OUT_W, OUT_H, Jimp.RESIZE_BICUBIC).blur(2);
  bg.scan(0, 0, OUT_W, OUT_H, function (x, y, idx) {
    const t = y / OUT_H;
    const k = 1.04 - t * 0.16;
    this.bitmap.data[idx] = Math.min(255, this.bitmap.data[idx] * k);
    this.bitmap.data[idx + 1] = Math.min(255, this.bitmap.data[idx + 1] * k);
    this.bitmap.data[idx + 2] = Math.min(255, this.bitmap.data[idx + 2] * k);
  });

  // ---- 4. Soft contact shadow under feet (blurred ellipse)
  // find lowest opaque row & horizontal extent near feet
  let feetY = 0, fMin = OUT_W, fMax = 0;
  person.scan(0, 0, OUT_W, OUT_H, function (x, y, idx) { if (this.bitmap.data[idx + 3] > 40 && y > feetY) feetY = y; });
  person.scan(0, Math.max(0, feetY - 40), OUT_W, Math.min(41, OUT_H - Math.max(0, feetY - 40)), function (x, y, idx) {
    if (this.bitmap.data[idx + 3] > 40) { if (x < fMin) fMin = x; if (x > fMax) fMax = x; }
  });
  if (fMax > fMin) {
    const shadow = new Jimp(OUT_W, OUT_H, 0x00000000);
    const scx = (fMin + fMax) / 2, rx = Math.max(60, (fMax - fMin) * 0.9), ry = Math.max(10, rx * 0.16), scy = feetY - 4;
    shadow.scan(0, 0, OUT_W, OUT_H, function (x, y, idx) {
      const dx = (x - scx) / rx, dy = (y - scy) / ry, e = dx * dx + dy * dy;
      if (e < 1) this.bitmap.data[idx + 3] = Math.round(140 * (1 - e));
    });
    shadow.blur(10);
    bg.composite(shadow, 0, 0);
  }

  // ---- 5. Composite + subtle warm/tone match toward backdrop
  bg.composite(person, 0, 0);
  const out = await bg.quality(92).getBufferAsync(Jimp.MIME_JPEG);
  return fal.storage.upload(new Blob([out], { type: "image/jpeg" }));
}
