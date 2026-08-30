import { json } from "@remix-run/node";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const productImageUrl = formData.get("product_image_url");
    const productTitle = formData.get("product_title") || "garment";
    const userPhotoFile = formData.get("user_photo");

    if (!productImageUrl || !userPhotoFile) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return json({ error: "AI not configured" }, { status: 503 });
    }

    // Convert uploaded file to base64 data URI
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = userPhotoFile.type || "image/jpeg";
    const userPhotoDataUri = `data:${mimeType};base64,${base64}`;

    // Use IDM-VTON model for virtual try-on
    const output = await replicate.run("cuuupid/idm-vton", {
      input: {
        human_img: userPhotoDataUri,
        garm_img: productImageUrl,
        garment_des: productTitle,
      },
    });

    const resultUrl = Array.isArray(output) ? output[0] : output;

    return json({ success: true, result_url: String(resultUrl) });
  } catch (error) {
    console.error("Try-on error:", error);
    return json({ error: "Try-on failed", details: error.message }, { status: 500 });
  }
};

export const loader = async () => {
  return json({
    enabled: true,
    buttonText: "Try On",
    buttonColor: "#111111",
    buttonTextColor: "#ffffff",
    modalTitle: "Try it before you buy",
  });
};
