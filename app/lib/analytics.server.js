import { prisma } from "../shopify.server";

const DAY = 24 * 60 * 60 * 1000;

/* Same category rules as the storefront (title/type/tags) — used to group try-ons by category */
const JW = "necklace,neckpiece,pendant,choker,mangalsutra,locket, haar ,earring,jhumka,jhumki,chandbali,tikka,matha patti,nose ring,nose pin,nath ,jewellery set,jewelry set".split(",");
const SW = "shoe,sneaker,trainer,heels, heel ,stiletto,sandal,slipper,loafer,moccasin, boot , boots ,mojari,jutti,kolhapuri,chappal,footwear, flats ,mules,clogs".split(",");
const HW = "bedsheet,bed sheet,bedding,comforter,duvet,quilt,dohar,blanket,pillow,cushion,curtain,rug ,carpet,table cloth,tablecloth,wall art,painting,tapestry,sofa cover".split(",");
const GW = "blouse,kurta,kurti,dress,gown,saree,sari,lehenga,top ,shirt,jacket,coat,skirt,trouser,pants,jeans,jumpsuit,co ord,anarkali,sharara,suit ".split(",");
export function categoryOf(title) {
  const hay = ` ${String(title || "").toLowerCase().replace(/[-_,/|().&]/g, " ")} `;
  const has = (l) => l.some((w) => hay.includes(w));
  if (has(JW)) return "Jewellery";
  if (has(SW) && !has(GW)) return "Footwear";
  if (has(HW)) return "Home decor";
  return "Clothing";
}

const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const delta = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0);

/**
 * Full dashboard analytics for one shop over `days`, with the previous period for comparison.
 * tzOffsetMin = shop timezone offset in minutes (for day / hour buckets).
 */
export async function buildAnalytics(shop, days = 30, tzOffsetMin = 330) {
  const now = Date.now();
  const since = new Date(now - days * DAY);
  const prevSince = new Date(now - 2 * days * DAY);

  const [rows, prevRows, gallery] = await Promise.all([
    prisma.tryOnLog.findMany({
      where: { shop, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" }, take: 20000,
      select: { productId: true, productTitle: true, status: true, revenue: true, createdAt: true, resultUrl: true },
    }),
    prisma.tryOnLog.groupBy({
      by: ["status"], where: { shop, createdAt: { gte: prevSince, lt: since } },
      _count: { _all: true }, _sum: { revenue: true },
    }).catch(() => []),
    prisma.tryOnLog.findMany({
      where: { shop, status: "completed", resultUrl: { not: "" }, NOT: { resultUrl: "client-fallback" } },
      orderBy: { createdAt: "desc" }, take: 12,
      select: { id: true, resultUrl: true, productTitle: true, createdAt: true },
    }),
  ]);

  const c = { completed: 0, added_to_cart: 0, converted: 0, feedback_up: 0, feedback_down: 0, share: 0 };
  let revenue = 0;
  const products = {};
  const cats = {};
  const local = (d) => new Date(new Date(d).getTime() + tzOffsetMin * 60000);
  const dayKey = (d) => local(d).toISOString().slice(0, 10);
  const series = {};
  for (let i = days - 1; i >= 0; i--) series[dayKey(now - i * DAY)] = { t: 0, a: 0 };
  const weekday = Array(7).fill(0);
  const hours = Array(24).fill(0);

  for (const r of rows) {
    if (c[r.status] !== undefined) c[r.status]++;
    const p = (products[r.productId] ||= { id: r.productId, title: r.productTitle || "Product", tries: 0, atc: 0, orders: 0, revenue: 0, up: 0, down: 0, last: null });
    if (!p.title || p.title === "Product") p.title = r.productTitle || p.title;
    if (r.status === "completed") {
      p.tries++; p.last = p.last || r.createdAt;
      const k = dayKey(r.createdAt); if (series[k]) series[k].t++;
      const L = local(r.createdAt); weekday[L.getUTCDay()]++; hours[L.getUTCHours()]++;
      const cat = categoryOf(r.productTitle); cats[cat] = (cats[cat] || 0) + 1;
    }
    if (r.status === "added_to_cart") { p.atc++; const k = dayKey(r.createdAt); if (series[k]) series[k].a++; }
    if (r.status === "converted") { p.orders++; p.revenue += r.revenue || 0; revenue += r.revenue || 0; }
    if (r.status === "feedback_up") p.up++;
    if (r.status === "feedback_down") p.down++;
  }

  const prev = { completed: 0, added_to_cart: 0, converted: 0, revenue: 0, feedback_up: 0, feedback_down: 0, share: 0 };
  for (const g of prevRows) { if (prev[g.status] !== undefined) prev[g.status] = g._count._all; if (g.status === "converted") prev.revenue = g._sum.revenue || 0; }

  const fb = c.feedback_up + c.feedback_down;
  const prevFb = prev.feedback_up + prev.feedback_down;
  const kpis = {
    tryOns: { v: c.completed, d: delta(c.completed, prev.completed) },
    atc: { v: c.added_to_cart, d: delta(c.added_to_cart, prev.added_to_cart) },
    atcRate: { v: pct(c.added_to_cart, c.completed), d: pct(c.added_to_cart, c.completed) - pct(prev.added_to_cart, prev.completed) },
    orders: { v: c.converted, d: delta(c.converted, prev.converted) },
    revenue: { v: revenue, d: delta(revenue, prev.revenue) },
    satisfaction: { v: fb ? pct(c.feedback_up, fb) : null, d: fb && prevFb ? pct(c.feedback_up, fb) - pct(prev.feedback_up, prevFb) : 0, n: fb },
    shares: { v: c.share, d: delta(c.share, prev.share) },
    productsTried: { v: Object.values(products).filter((p) => p.tries > 0).length },
    perDay: { v: c.completed / days },
  };

  const top = Object.values(products).filter((p) => p.tries > 0).sort((a, b) => b.tries - a.tries).slice(0, 10);

  const activity = rows.slice(0, 25).map((r) => ({ status: r.status, title: r.productTitle || "Product", at: r.createdAt, revenue: r.revenue || 0, img: r.status === "completed" && r.resultUrl && r.resultUrl !== "client-fallback" ? r.resultUrl : null }));

  return {
    days, kpis,
    series: Object.entries(series).map(([date, v]) => ({ date, tryOns: v.t, atc: v.a })),
    funnel: { tryOns: c.completed, atc: c.added_to_cart, orders: c.converted },
    categories: Object.entries(cats).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    weekday, hours, top, activity, gallery,
  };
}
