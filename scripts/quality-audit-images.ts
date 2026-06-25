import { prisma } from "@/lib/db";
import { imageStatus, qualityAuditImages } from "@/lib/product-images";

async function main() {
  const result = await qualityAuditImages();
  const status = await imageStatus();
  console.log(JSON.stringify({ ...result, status }, null, 2));
}

main()
  .catch((error) => {
    console.error("[images:quality-audit] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
