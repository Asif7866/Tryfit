import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  BlockStack,
  Text,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { prisma } from "../shopify.server";
import shopify from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.shopSettings.create({ data: { shop } });
  }

  return json({ settings });
};

export const action = async ({ request }) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const settings = await prisma.shopSettings.upsert({
    where: { shop },
    update: {
      enabled: formData.get("enabled") === "true",
      buttonText: formData.get("buttonText") || "Try The Look",
      buttonColor: formData.get("buttonColor") || "#000000",
      buttonTextColor: formData.get("buttonTextColor") || "#FFFFFF",
      modalTitle: formData.get("modalTitle") || "Ready to try this on?",
      monthlyLimit: parseInt(formData.get("monthlyLimit") || "500"),
    },
    create: {
      shop,
      enabled: formData.get("enabled") === "true",
      buttonText: formData.get("buttonText") || "Try The Look",
      buttonColor: formData.get("buttonColor") || "#000000",
      buttonTextColor: formData.get("buttonTextColor") || "#FFFFFF",
      modalTitle: formData.get("modalTitle") || "Ready to try this on?",
      monthlyLimit: parseInt(formData.get("monthlyLimit") || "500"),
    },
  });

  return json({ settings, saved: true });
};

export default function Settings() {
  const { settings } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const [enabled, setEnabled] = useState(settings.enabled);
  const [buttonText, setButtonText] = useState(settings.buttonText);
  const [buttonColor, setButtonColor] = useState(settings.buttonColor);
  const [buttonTextColor, setButtonTextColor] = useState(settings.buttonTextColor);
  const [modalTitle, setModalTitle] = useState(settings.modalTitle);
  const [monthlyLimit, setMonthlyLimit] = useState(String(settings.monthlyLimit));

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("enabled", String(enabled));
    formData.append("buttonText", buttonText);
    formData.append("buttonColor", buttonColor);
    formData.append("buttonTextColor", buttonTextColor);
    formData.append("modalTitle", modalTitle);
    formData.append("monthlyLimit", monthlyLimit);
    submit(formData, { method: "post" });
  }, [enabled, buttonText, buttonColor, buttonTextColor, modalTitle, monthlyLimit, submit]);

  return (
    <Page title="Settings" backAction={{ url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">General</Text>
              <Checkbox
                label="Enable Virtual Try-On"
                checked={enabled}
                onChange={setEnabled}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Appearance</Text>
              <FormLayout>
                <TextField
                  label="Button Text"
                  value={buttonText}
                  onChange={setButtonText}
                  autoComplete="off"
                />
                <FormLayout.Group>
                  <TextField
                    label="Button Color"
                    value={buttonColor}
                    onChange={setButtonColor}
                    autoComplete="off"
                    prefix="#"
                  />
                  <TextField
                    label="Button Text Color"
                    value={buttonTextColor}
                    onChange={setButtonTextColor}
                    autoComplete="off"
                    prefix="#"
                  />
                </FormLayout.Group>
                <TextField
                  label="Modal Title"
                  value={modalTitle}
                  onChange={setModalTitle}
                  autoComplete="off"
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Limits</Text>
              <TextField
                label="Monthly Try-On Limit"
                type="number"
                value={monthlyLimit}
                onChange={setMonthlyLimit}
                autoComplete="off"
                helpText="Maximum try-ons per month (0 = unlimited)"
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            Save Settings
          </Button>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
