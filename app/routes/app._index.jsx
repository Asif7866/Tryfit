import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await shopify.authenticate.admin(request);
  return json({ shop: session.shop });
};

export default function Index() {
  const { shop } = useLoaderData();

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>TryFit Dashboard</h1>
      <p>Connected to: <strong>{shop}</strong></p>
      <p>App is running! ✅</p>
    </div>
  );
}
