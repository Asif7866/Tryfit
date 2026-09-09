import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== "tryfit-fix-2026") {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  const prisma = new PrismaClient();
  try {
    const logs = await prisma.tryOnLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
    const settings = await prisma.shopSettings.findMany();
    const sessions = await prisma.session.findMany({ select: { id: true, shop: true, isOnline: true } });
    return json({ logs, settings, sessions });
  } catch (e) {
    return json({ error: e.message });
  } finally {
    await prisma.$disconnect();
  }
};
