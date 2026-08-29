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
import { prisma } from "../shopify.server";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.shopSettings.create({
      data: { shop },
    });
  }

  const recentTryOns = await prisma.tryOnLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const totalThisMonth = await prisma.tryOnLog.count({
    where: {
      shop,
      createdAt: {
        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
    },
  });

  return json({ settings, recentTryOns, totalThisMonth });
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
                {recentTryOns.length === 0 ? (
                  <Text as="p" tone="subdued">No try-ons yet.</Text>
                ) : (
                  recentTryOns.map((log) => (
                    <Box key={log.id} padding="200" borderWidth="025" borderColor="border" borderRadius="100">
                      <InlineStack align="space-between">
                        <Text as="span">{log.productTitle || log.productId}</Text>
                        <InlineStack gap="200">
                          <Badge tone={log.status === "completed" ? "success" : log.status === "failed" ? "critical" : "info"}>
                            {log.status}
                          </Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {new Date(log.createdAt).toLocaleDateString()}
                          </Text>
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  ))
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
