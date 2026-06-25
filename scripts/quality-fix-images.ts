import { prisma } from "@/lib/db";
import { imageStatus, qualityFixImages } from "@/lib/product-images";

async function main() {
  const result = await qualityFixImages();
  const status = await imageStatus();
  console.log(JSON.stringify({ ...result, status }, null, 2));
}

main()
  .catch((error) => {
    console.error("[images:quality-fix] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
