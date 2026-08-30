import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
} from "@shopify/polaris";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  await shopify.authenticate.admin(request);

  return json({
    settings: { enabled: true, monthlyLimit: 100, totalTryOns: 0 },
    recentTryOns: [],
    totalThisMonth: 0,
  });
};

export default function Index() {
  const { settings, recentTryOns, totalThisMonth } = useLoaderData();

  return (
    <Page title="Virtual Try-On Dashboard">
      <BlockStack gap="500">
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Status</Text>
                <Badge tone={settings.enabled ? "success" : "critical"}>
                  {settings.enabled ? "Active" : "Disabled"}
                </Badge>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">This Month</Text>
                <Text as="p" variant="headingLg">{totalThisMonth}</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  of {settings.monthlyLimit} limit
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">All Time</Text>
                <Text as="p" variant="headingLg">{settings.totalTryOns}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Recent Try-Ons</Text>
                <Text as="p" tone="subdued">No try-ons yet. App is running!</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
