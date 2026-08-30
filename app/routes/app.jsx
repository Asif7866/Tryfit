import { json } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return json({ 
    apiKey,
    polarisTranslations: { Polaris: { ResourceList: { sortingLabel: "Sort by" } } },
  });
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return (
    <div style={{ padding: "2rem" }}>
      <h1>App Error</h1>
      <p>Something went wrong loading the app.</p>
    </div>
  );
}
