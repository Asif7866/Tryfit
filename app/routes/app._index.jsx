import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, Text, BlockStack, Badge, Layout } from "@shopify/polaris";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "unknown";
  return json({ shop });
};

export default function Index() {
  const { shop } = useLoaderData();

  return (
    <Page title="Virtual Try-On Dashboard">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Status</Text>
              <Badge tone="success">Active</Badge>
              <Text as="p">Connected to: {shop}</Text>
              <Text as="p">App is running!</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
