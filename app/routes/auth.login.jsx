import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  return json({ shop });
};

export default function Auth() {
  const { shop } = useLoaderData();
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>TryFit Login</h1>
      {shop && <p>Shop: {shop}</p>}
      <p>Redirecting to Shopify...</p>
    </div>
  );
}
