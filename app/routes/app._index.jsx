import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, Badge } from "@shopify/polaris";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { session } = await shopify.authenticate.admin(request);
    return json({ shop: session.shop, error: null });
  } catch (e) {
    return json({ shop: "unknown", error: e.message });
  }
};

export default function Index() {
  const { shop, error } = useLoaderData();

  if (error) {
    return <div style={{ padding: "2rem" }}><p>Error: {error}</p></div>;
  }

  return (
    <Page title="Virtual Try-On Dashboard">
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Status</Text>
                <Badge tone="success">Active</Badge>
                <Text as="p" variant="bodySm" tone="subdued">
                  Connected to {shop}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
