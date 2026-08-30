import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Badge, Box, Icon, Divider, InlineGrid, Link
} from "@shopify/polaris";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await shopify.authenticate.admin(request);
    const shop = session.shop;

    // Fetch products from Shopify
    const productsRes = await admin.graphql(`{
      products(first: 5, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            id
            title
            status
            totalInventory
            featuredImage { url }
            onlineStorePreviewUrl
          }
        }
      }
      productsCount { count }
    }`);
    const productsData = await productsRes.json();
    const products = productsData.data.products.edges.map(e => e.node);
    const totalProducts = productsData.data.productsCount.count;

    return json({ 
      shop, 
      products, 
      totalProducts,
      error: null 
    });
  } catch (e) {
    return json({ 
      shop: "unknown", 
      products: [], 
      totalProducts: 0,
      error: e.message 
    });
  }
};

function StatCard({ title, value, subtitle, tone = "success" }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">{title}</Text>
        <Text as="p" variant="headingXl">{value}</Text>
        {subtitle && (
          <Badge tone={tone}>{subtitle}</Badge>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Index() {
  const { shop, products, totalProducts, error } = useLoaderData();

  if (error) {
    return (
      <Page title="TryFit Dashboard">
        <Card>
          <BlockStack gap="200">
            <Text as="p" tone="critical">Error: {error}</Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Virtual Try-On Dashboard">
      <BlockStack gap="500">

        {/* Stats Row */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <StatCard title="Status" value="Active" subtitle="Running" tone="success" />
          <StatCard title="Total Products" value={totalProducts} subtitle="In Store" tone="info" />
          <StatCard title="Try-Ons Today" value="0" subtitle="No activity yet" tone="attention" />
          <StatCard title="Conversion Rate" value="—" subtitle="Needs data" tone="info" />
        </InlineGrid>

        {/* Main Content */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Recent Products</Text>
                  <Badge tone="info">{totalProducts} total</Badge>
                </InlineStack>
                <Divider />
                {products.length === 0 ? (
                  <Text as="p" tone="subdued">No products found.</Text>
                ) : (
                  <BlockStack gap="300">
                    {products.map((product) => (
                      <Box key={product.id} padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                        <InlineStack align="space-between" blockAlign="center" gap="300">
                          <InlineStack gap="300" blockAlign="center">
                            {product.featuredImage?.url ? (
                              <img 
                                src={product.featuredImage.url} 
                                alt={product.title}
                                style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }}
                              />
                            ) : (
                              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                <Text as="span" variant="bodySm">📷</Text>
                              </Box>
                            )}
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{product.title}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Stock: {product.totalInventory ?? "N/A"}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          <InlineStack gap="200">
                            <Badge tone={product.status === "ACTIVE" ? "success" : "attention"}>
                              {product.status}
                            </Badge>
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Store Info</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Shop</Text>
                      <Text as="p" variant="bodySm">{shop}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Plan</Text>
                      <Badge tone="success">Free</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Extension</Text>
                      <Badge tone="success">Installed</Badge>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Quick Setup</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span">✅</Text>
                      <Text as="p" variant="bodySm">App installed</Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span">✅</Text>
                      <Text as="p" variant="bodySm">Extension deployed</Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span">⏳</Text>
                      <Text as="p" variant="bodySm">Add Replicate API token</Text>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span">⏳</Text>
                      <Text as="p" variant="bodySm">Enable on product page</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

      </BlockStack>
    </Page>
  );
}
