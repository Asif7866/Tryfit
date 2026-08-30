import "@shopify/shopify-app-remix/adapters/node";
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const appUrl = process.env.SHOPIFY_APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || "https://localhost";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: "2024-10",
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new SQLiteSessionStorage("/tmp/session.db"),
  distribution: "singleMerchant",
  isEmbeddedApp: true,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export { prisma };
