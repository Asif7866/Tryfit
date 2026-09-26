import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { useState, useMemo, useEffect } from "react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack, TextField, RangeSlider,
  Button, Badge, Banner, Box, Checkbox, Thumbnail, Divider, InlineGrid,
} from "@shopify/polaris";
import shopify, { prisma } from "../shopify.server";

const DEFAULTS = { buttonText: "TRY ON", buttonColor: "#111111", buttonTextColor: "#FFFFFF", buttonRadius: 12 };

async function fetchProducts(admin, query = "") {
  const q = query ? `, query: "title:*${query.replace(/"/g, "")}*"` : "";
  const res = await admin.graphql(`{
    products(first: 50, sortKey: TITLE${q}) {
      edges { node { id title status featuredImage { url } } }
    }
  }`);
  const data = await res.json();
  return (data.data?.products?.edges || []).map(e => ({
    id: e.node.id.replace("gid://shopify/Product/", ""),
    title: e.node.title,
    status: e.node.status,
    image: e.node.featuredImage?.url || null,
  }));
}

export const loader = async ({ request }) => {
  const { admin, session } = await shopify.authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const [settings, products] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { shop: session.shop } }),
    fetchProducts(admin, query),
  ]);
  const cfg = {
    buttonText: settings?.buttonText || DEFAULTS.buttonText,
    buttonColor: settings?.buttonColor || DEFAULTS.buttonColor,
    buttonTextColor: settings?.buttonTextColor || DEFAULTS.buttonTextColor,
    buttonRadius: DEFAULTS.buttonRadius,
    disabledProducts: Array.isArray(settings?.disabledProducts) ? settings.disabledProducts.map(String) : [],
  };
  return json({ shop: session.shop, cfg, products, query });
};

export const action = async ({ request }) => {
  const { admin, session } = await shopify.authenticate.admin(request);
  const fd = await request.formData();
  const buttonText = String(fd.get("buttonText") || DEFAULTS.buttonText).slice(0, 40);
  const buttonColor = String(fd.get("buttonColor") || DEFAULTS.buttonColor);
  const buttonTextColor = String(fd.get("buttonTextColor") || DEFAULTS.buttonTextColor);
  const buttonRadius = parseInt(fd.get("buttonRadius") || DEFAULTS.buttonRadius, 10);
  let disabledProducts = [];
  try { disabledProducts = JSON.parse(fd.get("disabledProducts") || "[]").map(String); } catch (e) {}

  await prisma.shopSettings.upsert({
    where: { shop: session.shop },
    update: { buttonText, buttonColor, buttonTextColor, disabledProducts },
    create: { shop: session.shop, buttonText, buttonColor, buttonTextColor, disabledProducts, enabled: true },
  });

  // Push config to shop metafield so the storefront block reads it without extra requests
  let metafieldError = null;
  try {
    const shopIdRes = await admin.graphql(`{ shop { id } }`);
    const shopId = (await shopIdRes.json()).data.shop.id;
    const mfRes = await admin.graphql(`
      mutation SetCfg($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`, {
      variables: {
        metafields: [{
          ownerId: shopId,
          namespace: "tryfit",
          key: "config",
          type: "json",
          value: JSON.stringify({ buttonText, buttonColor, buttonTextColor, buttonRadius, disabledProducts }),
        }],
      },
    });
    const mf = await mfRes.json();
    const errs = mf.data?.metafieldsSet?.userErrors || [];
    if (errs.length) metafieldError = errs.map(e => e.message).join(", ");
  } catch (e) {
    metafieldError = e.message;
  }

  return json({ ok: true, metafieldError, savedAt: Date.now() });
};

export default function Settings() {
  const { cfg, products, query } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  const [buttonText, setButtonText] = useState(cfg.buttonText);
  const [buttonColor, setButtonColor] = useState(cfg.buttonColor);
  const [buttonTextColor, setButtonTextColor] = useState(cfg.buttonTextColor);
  const [buttonRadius, setButtonRadius] = useState(cfg.buttonRadius);
  const [disabled, setDisabled] = useState(new Set(cfg.disabledProducts));
  const [search, setSearch] = useState(query);
  const [toast, setToast] = useState(false);

  useEffect(() => { if (actionData?.ok) { setToast(true); const t = setTimeout(() => setToast(false), 3000); return () => clearTimeout(t); } }, [actionData?.savedAt]);

  const dirty = useMemo(() => {
    const d = [...disabled].sort().join(",") !== [...cfg.disabledProducts].sort().join(",");
    return d || buttonText !== cfg.buttonText || buttonColor !== cfg.buttonColor || buttonTextColor !== cfg.buttonTextColor || buttonRadius !== cfg.buttonRadius;
  }, [disabled, buttonText, buttonColor, buttonTextColor, buttonRadius, cfg]);

  const save = () => {
    const fd = new FormData();
    fd.append("buttonText", buttonText);
    fd.append("buttonColor", buttonColor);
    fd.append("buttonTextColor", buttonTextColor);
    fd.append("buttonRadius", String(buttonRadius));
    fd.append("disabledProducts", JSON.stringify([...disabled]));
    submit(fd, { method: "post" });
  };

  const toggle = (id) => setDisabled(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const enabledCount = products.filter(p => !disabled.has(p.id)).length;

  return (
    <Page
      title="Settings"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{ content: "Save", onAction: save, loading: saving, disabled: !dirty }}
    >
      <Layout>
        {toast && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setToast(false)}>Settings saved. Changes are live on your storefront.</Banner>
          </Layout.Section>
        )}
        {actionData?.metafieldError && (
          <Layout.Section>
            <Banner tone="warning" title="Saved, but storefront sync failed">
              <p>{actionData.metafieldError}. Button styling will fall back to your theme editor settings.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Button customization */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Try-on button</Text>
                <Text as="p" variant="bodySm" tone="subdued">Controls how the button looks on your product pages.</Text>
              </BlockStack>
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <BlockStack gap="400">
                  <TextField label="Button text" value={buttonText} onChange={setButtonText} maxLength={40} showCharacterCount autoComplete="off" />
                  <InlineGrid columns={2} gap="300">
                    <TextField label="Button color" value={buttonColor} onChange={setButtonColor} autoComplete="off"
                      prefix={<span style={{ display: "inline-block", width: 16, height: 16, borderRadius: 4, background: buttonColor, border: "1px solid #ccc" }} />} />
                    <TextField label="Text color" value={buttonTextColor} onChange={setButtonTextColor} autoComplete="off"
                      prefix={<span style={{ display: "inline-block", width: 16, height: 16, borderRadius: 4, background: buttonTextColor, border: "1px solid #ccc" }} />} />
                  </InlineGrid>
                  <RangeSlider label="Corner radius" value={buttonRadius} onChange={setButtonRadius} min={0} max={30} step={2} output suffix={<Text as="span" variant="bodySm">{buttonRadius}px</Text>} />
                </BlockStack>
                <Box background="bg-surface-secondary" borderRadius="300" padding="600">
                  <BlockStack gap="300" inlineAlign="center">
                    <Text as="p" variant="bodySm" tone="subdued">Preview</Text>
                    <button type="button" style={{
                      display: "inline-flex", alignItems: "center", gap: 8, width: "100%", maxWidth: 320, justifyContent: "center",
                      padding: "16px 24px", background: buttonColor, color: buttonTextColor, border: "none",
                      borderRadius: buttonRadius, fontWeight: 600, fontSize: 15, cursor: "default",
                    }}>
                      <span>{buttonText || "TRY ON"}</span>
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 999, background: "rgba(255,255,255,.2)" }}>AI</span>
                    </button>
                  </BlockStack>
                </Box>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Product-level control */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Products</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Turn try-on off for products where results aren't a good fit (e.g. heavily draped garments).</Text>
                  </BlockStack>
                  <Badge tone="info">{enabledCount} of {products.length} enabled</Badge>
                </InlineStack>
                <TextField
                  label="Search products" labelHidden placeholder="Search products" value={search} onChange={setSearch}
                  autoComplete="off" clearButton onClearButtonClick={() => { setSearch(""); submit({ q: "" }, { method: "get" }); }}
                  connectedRight={<Button onClick={() => submit({ q: search }, { method: "get" })}>Search</Button>}
                />
                <InlineStack gap="200">
                  <Button size="slim" onClick={() => setDisabled(new Set())}>Enable all</Button>
                  <Button size="slim" onClick={() => setDisabled(new Set(products.map(p => p.id)))}>Disable all shown</Button>
                </InlineStack>
              </BlockStack>
            </Box>
            <Divider />
            {products.length === 0 ? (
              <Box padding="800"><InlineStack align="center"><Text as="p" tone="subdued">No products found.</Text></InlineStack></Box>
            ) : products.map((p, i) => (
              <div key={p.id}>
                <Box paddingBlock="300" paddingInline="400">
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Thumbnail size="small" source={p.image || "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"} alt={p.title} />
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight="medium">{p.title}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{p.status === "ACTIVE" ? "Active" : p.status}</Text>
                      </BlockStack>
                    </InlineStack>
                    <Checkbox label="Try-on enabled" labelHidden checked={!disabled.has(p.id)} onChange={() => toggle(p.id)} />
                  </InlineStack>
                </Box>
                {i < products.length - 1 && <Divider />}
              </div>
            ))}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
