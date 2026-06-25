import { prisma } from "@/lib/db";
import { processImageQueue } from "@/lib/product-images";

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const all = process.argv.includes("--all");
  const retryErrors = process.argv.includes("--retry-errors");
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Number(process.env.PRODUCT_IMAGE_LIMIT ?? 50);
  console.log(`[images:fetch] Buscando imagenes para ${all ? "todo el catalogo pendiente" : `${limit} productos`}...`);
  console.log("[images:fetch] Fuentes: CSV/manual via admin, PRODUCT_IMAGE_SEARCH_ENDPOINT, BING_IMAGE_SEARCH_KEY o DuckDuckGo fallback.");
  const result = await processImageQueue({ limit: Number.isFinite(limit) ? limit : 50, all, retryErrors });
  for (const row of result.results) {
    if (row.ok) {
      console.log(`[ok] ${row.codigoInterno} -> ${row.localPath} (${row.status})`);
    } else {
      console.log(`[skip] ${row.codigoInterno}: ${row.error}`);
    }
  }
  console.log(`[images:fetch] Pobladas ${result.populated}/${result.scanned}`);
  console.log(`[images:fetch] Progreso ${result.progress.done}/${result.progress.total} (${result.progress.percent}%). ETA aprox: ${result.progress.etaMinutes ?? "-"} min`);
}

main()
  .catch((error) => {
    console.error("[images:fetch] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
