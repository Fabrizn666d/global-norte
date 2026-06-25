import { prisma } from "@/lib/db";
import { imageStatus, promotePendingImages } from "@/lib/product-images";

function argNumber(name: string, fallback: number) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split("=")[1]);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  const minConfidence = argNumber("--min-confidence", 95);
  const brandMatch = process.argv.includes("--brand-match");
  const dryRun = process.argv.includes("--dry-run");
  const result = await promotePendingImages({ minConfidence, brandMatch, dryRun });
  const status = await imageStatus();
  console.log(JSON.stringify({ ...result, status }, null, 2));
}

main()
  .catch((error) => {
    console.error("[images:promote] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
