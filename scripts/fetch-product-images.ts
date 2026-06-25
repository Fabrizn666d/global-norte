import { prisma } from "@/lib/db";
import { fetchImagesForProducts } from "@/lib/product-images";

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Number(process.env.PRODUCT_IMAGE_LIMIT ?? 30);
  console.log(`[images:fetch] Buscando imagenes para ${limit} productos sin imagen real...`);
  console.log("[images:fetch] Fuentes: CSV/manual via admin, PRODUCT_IMAGE_SEARCH_ENDPOINT, BING_IMAGE_SEARCH_KEY o DuckDuckGo fallback.");
  const result = await fetchImagesForProducts(Number.isFinite(limit) ? limit : 30);
  for (const row of result.results) {
    if (row.ok) {
      console.log(`[ok] ${row.codigoInterno} -> ${row.localPath} (${row.status})`);
    } else {
      console.log(`[skip] ${row.codigoInterno}: ${row.error}`);
    }
  }
  console.log(`[images:fetch] Pobladas ${result.populated}/${result.scanned}`);
}

main()
  .catch((error) => {
    console.error("[images:fetch] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
