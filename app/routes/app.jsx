import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);
  } catch (e) {
    const u = new URL(request.url);
    if (e instanceof Response) {
      console.error("[AUTH FAIL]", e.status, u.pathname, "params:", [...u.searchParams.keys()].join(","),
        "hasAuthHeader:", !!request.headers.get("authorization"), "resp-headers:", JSON.stringify(Object.fromEntries(e.headers)));
    } else {
      console.error("[AUTH ERR]", e?.message || e);
    }
    throw e;
  }
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData();
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}

// Required for embedded auth: forwards Shopify's reauth headers / error responses
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
