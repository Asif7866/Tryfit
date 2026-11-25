import "@shopify/shopify-app-remix/adapters/node";
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const appUrl = process.env.SHOPIFY_APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || "https://localhost";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: "2026-07",
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: "appStore",
  isEmbeddedApp: true,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true, // required for all public apps by Jan 1, 2027
  },
});

// Background: move existing installs to expiring offline tokens (non-blocking)
if (process.env.NODE_ENV !== "development" && !globalThis.__tokenMigrate) {
  globalThis.__tokenMigrate = true;
  const run = () => import("./lib/migrate-offline-tokens.server.js").then((m) => m.migrateOfflineTokens()).catch((e) => console.error("[token-migrate]", e.message));
  setTimeout(run, 15000);
  setInterval(run, 6 * 60 * 60 * 1000).unref?.(); // retry stragglers every 6h
}

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export { prisma };
