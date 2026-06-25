import { prisma } from "@/lib/db";
import { ImagePipelineMode, processImageQueue, productBrandDictionary } from "@/lib/product-images";

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
  const all = process.argv.includes("--all");
  const retryErrors = process.argv.includes("--retry-errors");
  const mode: ImagePipelineMode = process.argv.includes("--fast")
    ? "fast"
    : process.argv.includes("--pending")
      ? "pending"
      : process.argv.includes("--deep")
        ? "deep"
        : process.argv.includes("--manual")
          ? "manual"
          : "default";
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Number(process.env.PRODUCT_IMAGE_LIMIT ?? 50);
  const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : Number(process.env.PRODUCT_IMAGE_CONCURRENCY ?? (mode === "fast" ? 10 : mode === "deep" ? 3 : 5));
  const brands = await productBrandDictionary();
  console.log(`[images:fetch] Modo ${mode.toUpperCase()} para ${all ? "todo el catalogo pendiente" : `${limit} productos`} con ${concurrency} workers...`);
  console.log(`[images:fetch] Diccionario de marcas: ${brands.slice(0, 18).join(", ")}${brands.length > 18 ? ` +${brands.length - 18}` : ""}`);
  console.log("[images:fetch] Fuentes: CSV/manual via admin, PRODUCT_IMAGE_SEARCH_ENDPOINT, BING_IMAGE_SEARCH_KEY o DuckDuckGo fallback.");
  const result = await processImageQueue({
    limit: Number.isFinite(limit) ? limit : 50,
    all,
    retryErrors,
    mode,
    concurrency: Number.isFinite(concurrency) ? concurrency : undefined,
    onProgress(progress) {
      process.stdout.write(`\r[progress] ${progress.processed}/${progress.total} | ok ${progress.approved} | pending ${progress.pending} | rechazadas ${progress.rejected} | ${progress.speedPerMinute}/min | ETA ${progress.etaMinutes ?? "-"}m   `);
    },
  });
  process.stdout.write("\n");
  for (const row of result.results) {
    if (row.ok) {
      console.log(`[ok] ${row.codigoInterno} -> ${row.localPath} (${row.status})`);
    } else if (mode === "manual") {
      console.log(`[manual] ${row.codigoInterno}: ${row.error}`);
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
