import "@shopify/shopify-app-remix/adapters/node";
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: "2024-10",
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.HOST || "",
  authPathPrefix: "/auth",
  sessionStorage: new SQLiteSessionStorage("./session.db"),
  distribution: "appStore",
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export { prisma };
