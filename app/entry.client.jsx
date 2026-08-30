import { RemixBrowser } from "@remix-run/react";
import { startTransition } from "react";
import { createRoot } from "react-dom/client";

startTransition(() => {
  const root = createRoot(document);
  root.render(<RemixBrowser />);
});
