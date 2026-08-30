import { RemixBrowser } from "@remix-run/react";
import { startTransition } from "react";
import { hydrateRoot, createRoot } from "react-dom/client";

startTransition(() => {
  try {
    hydrateRoot(document, <RemixBrowser />);
  } catch (e) {
    console.error("Hydration failed, falling back to client render:", e);
    const root = createRoot(document);
    root.render(<RemixBrowser />);
  }
});
