import { prisma } from "@/lib/db";
import { classifyCatalog } from "@/lib/catalog-classifier";

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;
  const result = await classifyCatalog({ apply: !dryRun && apply });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error("[catalog:classify] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
