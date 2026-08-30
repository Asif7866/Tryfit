import { json } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  return (
    <PolarisAppProvider i18n={enTranslations}>
      <Outlet />
    </PolarisAppProvider>
  );
}

export function ErrorBoundary() {
  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>App Error</h1>
      <p>Something went wrong.</p>
    </div>
  );
}
