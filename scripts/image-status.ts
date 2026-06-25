import { prisma } from "@/lib/db";
import { ensureImageJobs, imageStatus } from "@/lib/product-images";

async function main() {
  if (process.argv.includes("--sync-jobs")) {
    const created = await ensureImageJobs();
    console.log(`[images:status] Trabajos nuevos en cola: ${created}`);
  }
  const status = await imageStatus();
  console.log(JSON.stringify({
    totalProductos: status.total,
    conImagen: status.withImage,
    sinImagen: status.missing,
    pendientes: status.jobs.pending ?? 0,
    procesando: status.jobs.processing ?? 0,
    completados: status.jobs.completed ?? 0,
    rotas: status.broken,
    duplicadas: status.duplicates,
    porcentaje: `${status.percent}%`,
    ultimoLog: status.lastLog,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[images:status] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
