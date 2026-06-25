import { prisma } from "@/lib/db";
import { fetchImagesForProducts, isFakeProductImage, localImageExists } from "@/lib/product-images";

async function main() {
  const repair = process.argv.includes("--repair");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 30;
  const products = await prisma.product.findMany({ select: { id: true, codigoInterno: true, nombre: true, imagenPrincipal: true } });
  const picsum = products.filter((product) => product.imagenPrincipal?.includes("picsum.photos"));
  const missing = products.filter((product) => !product.imagenPrincipal || isFakeProductImage(product.imagenPrincipal));
  const broken = [];
  for (const product of products) {
    if (product.imagenPrincipal?.startsWith("/uploads/") && !(await localImageExists(product.imagenPrincipal))) broken.push(product);
  }
  console.log(JSON.stringify({ total: products.length, picsum: picsum.length, missing: missing.length, broken: broken.length }, null, 2));
  if (repair) {
    if (picsum.length) {
      const cleared = await prisma.product.updateMany({ where: { imagenPrincipal: { contains: "picsum.photos" } }, data: { imagenPrincipal: null, imagenes: "[]" } });
      console.log(`[images:audit] Picsum limpiados: ${cleared.count}`);
    }
    const result = await fetchImagesForProducts(Number.isFinite(limit) ? limit : 30);
    console.log(`[images:audit] Reparacion automatica: ${result.populated}/${result.scanned}`);
    for (const row of result.results) console.log(`${row.ok ? "[ok]" : "[skip]"} ${row.codigoInterno}: ${row.localPath ?? row.error}`);
  }
}

main()
  .catch((error) => {
    console.error("[images:audit] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
