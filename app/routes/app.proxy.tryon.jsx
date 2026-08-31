import { json } from "@remix-run/node";

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

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return json({ error: "AI not configured" }, { status: 503 });
    }

    // Convert uploaded file to base64 data URI
    const arrayBuffer = await userPhotoFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = userPhotoFile.type || "image/jpeg";
    const userPhotoDataUri = `data:${mimeType};base64,${base64}`;

    // Fix product image URL (Shopify returns protocol-relative URLs)
    let garmImg = productImageUrl;
    if (garmImg.startsWith("//")) garmImg = "https:" + garmImg;

    // Create prediction via Replicate API
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
        input: {
          human_img: userPhotoDataUri,
          garm_img: garmImg,
          garment_des: productTitle,
        },
      }),
    });

    const prediction = await createRes.json();
    
    if (!createRes.ok) {
      console.error("Replicate create error:", JSON.stringify(prediction));
      return json({ error: prediction.detail || "AI model error" }, { status: 500 });
    }

    // Poll for result
    let result = prediction;
    const getUrl = result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`;
    
    for (let i = 0; i < 60; i++) {
      if (result.status === "succeeded") break;
      if (result.status === "failed" || result.status === "canceled") {
        return json({ error: "AI generation failed" }, { status: 500 });
      }
      
      await new Promise(r => setTimeout(r, 2000));
      
      const pollRes = await fetch(getUrl, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      result = await pollRes.json();
    }

    if (result.status !== "succeeded") {
      return json({ error: "AI timeout" }, { status: 504 });
    }

    const resultUrl = Array.isArray(result.output) ? result.output[0] : result.output;
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
