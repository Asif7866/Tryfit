import { json } from "@remix-run/node";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const productImageUrl = formData.get("product_image_url");
    const userPhotoFile = formData.get("user_photo");

    if (!productImageUrl || !userPhotoFile) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    // Convert uploaded file to base64
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = userPhotoFile.type || "image/jpeg";
    const userPhotoDataUri = `data:${mimeType};base64,${base64}`;

    // Return both images for client-side compositing
    return json({
      success: true,
      user_photo: userPhotoDataUri,
      product_image: productImageUrl,
      mode: "client_composite",
    });
  } catch (error) {
    return json({ error: "Try-on failed", details: error.message }, { status: 500 });
  }
};

export const loader = async ({ request }) => {
  return json({
    enabled: true,
    buttonText: "Try On",
    buttonColor: "#111111",
    buttonTextColor: "#ffffff",
    modalTitle: "Try it before you buy",
  });
};
