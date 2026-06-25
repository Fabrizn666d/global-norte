import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { importProductImageCsv } from "@/lib/product-images";

async function main() {
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
  const filePath = fileArg?.split("=").slice(1).join("=") ?? process.env.PRODUCT_IMAGE_CSV;
  if (!filePath) {
    throw new Error("Indica un CSV con --file=imagenes.csv o PRODUCT_IMAGE_CSV=imagenes.csv");
  }
  const csv = await fs.readFile(filePath, "utf8");
  const result = await importProductImageCsv(csv);
  for (const row of result.results) {
    if (row.ok) {
      console.log(`[ok] ${row.codigoInterno} -> ${row.localPath}`);
    } else {
      console.log(`[error] ${row.codigoInterno || "(sin codigo)"}: ${row.error}`);
    }
  }
  console.log(`[images:import] Importadas ${result.imported}/${result.total}`);
}

main()
  .catch((error) => {
    console.error("[images:import] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
