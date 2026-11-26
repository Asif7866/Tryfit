#!/usr/bin/env node
// Saves the AI photo-guide images into the theme extension so Shopify's CDN serves them.
// Usage:  node scripts/pull-guides.mjs   (then: shopify app deploy)
import fs from "node:fs";
import path from "node:path";

const API = "https://tryfit-production.up.railway.app";
const OUT = path.resolve("extensions/try-on-block/assets");
const NAMES = ["full", "group", "selfie", "room", "closeup", "dark", "sfull", "scrop", "jportrait", "jfar", "jcovered"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
let ok = 0;
for (const n of NAMES) {
  const file = path.join(OUT, `tf-guide-${n}.jpg`);
  let done = false;
  for (let i = 1; i <= 6 && !done; i++) {
    try {
      const r = await fetch(`${API}/guide/${n}?w=360`);
      if (r.ok && (r.headers.get("content-type") || "").startsWith("image/")) {
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        console.log(`✓ ${n}  (${Math.round(fs.statSync(file).size / 1024)} KB)`);
        done = true; ok++;
      } else {
        process.stdout.write(`… ${n} not ready (${r.status}), retrying\n`);
        await sleep(10000);
      }
    } catch (e) {
      process.stdout.write(`… ${n} ${e.message}, retrying\n`);
      await sleep(10000);
    }
  }
  if (!done) console.log(`✗ ${n} — still not ready. Check ${API}/guide-status`);
}
console.log(`\n${ok}/${NAMES.length} saved to ${OUT}`);
console.log(ok === NAMES.length ? "Now run: shopify app deploy" : "Run this again in a minute for the missing ones.");
