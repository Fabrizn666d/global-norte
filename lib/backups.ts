import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/db";

export type BackupType = "database" | "uploads" | "pdfs" | "complete";
export type RestorePlan = { ok: boolean; summary: Record<string, unknown>; errors: string[] };

export function backupRoot() {
  return path.resolve(process.env.BACKUP_DIR ?? "./data/backups");
}

export function sqlitePath() {
  const configured = (process.env.DATABASE_URL ?? "file:../data/globalnorte.db").replace(/^file:/, "");
  if (path.isAbsolute(configured)) return path.resolve(configured);
  return path.resolve(process.cwd(), "prisma", configured);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function checksum(filePath: string) {
  const hash = createHash("sha256");
  const file = await fsp.readFile(filePath);
  hash.update(file);
  return hash.digest("hex");
}

async function addDirectory(archive: AdmZip, source: string, destination: string) {
  const exists = await fsp.stat(source).then((stat) => stat.isDirectory()).catch(() => false);
  if (exists) archive.addLocalFolder(source, destination);
}

async function directorySize(source: string) {
  const stat = await fsp.stat(source).catch(() => null);
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  const entries = await fsp.readdir(source, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) total += await directorySize(path.join(source, entry.name));
  return total;
}

async function backupManifest(type: BackupType) {
  const [
    products,
    clients,
    adminUsers,
    orders,
    categories,
    brands,
    mediaAssets,
    coupons,
    bonuses,
    notifications,
    banners,
    settings,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.user.count({ where: { rol: "cliente" } }),
    prisma.adminUser.count(),
    prisma.order.count(),
    prisma.category.count(),
    prisma.brand.count(),
    prisma.mediaAsset.count(),
    prisma.coupon.count(),
    prisma.bonus.count(),
    prisma.notification.count(),
    prisma.banner.count(),
    prisma.setting.count(),
  ]);
  const dbPath = sqlitePath();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  const pdfDir = path.resolve(process.env.PDF_DIR ?? "./public/pdfs");
  const dbSize = await fsp.stat(dbPath).then((stat) => stat.size).catch(() => 0);
  return {
    app: "Global Norte",
    version: process.env.npm_package_version ?? "0.1.0",
    createdAt: new Date().toISOString(),
    type,
    database: { engine: "SQLite", fileName: "globalnorte.db", size: dbSize, checksum: await checksum(dbPath).catch(() => null) },
    storage: {
      uploadsBytes: await directorySize(uploadDir),
      pdfsBytes: await directorySize(pdfDir),
    },
    counts: { products, clients, adminUsers, orders, categories, brands, mediaAssets, coupons, bonuses, notifications, banners, settings },
    restore: "Restaurar desde el panel admin o seguir RESTORE-BACKUP.md. No usar migrate reset.",
  };
}

async function createZip(filePath: string, type: BackupType) {
  const archive = new AdmZip();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  const pdfDir = path.resolve(process.env.PDF_DIR ?? "./public/pdfs");
  if (type === "uploads" || type === "complete") await addDirectory(archive, uploadDir, "uploads");
  if (type === "pdfs" || type === "complete") await addDirectory(archive, pdfDir, "pdfs");
  if (type === "complete") archive.addLocalFile(sqlitePath(), "database", "globalnorte.db");
  archive.addFile("manifest.json", Buffer.from(JSON.stringify(await backupManifest(type), null, 2)));
  archive.writeZip(filePath);
}

export async function generateBackup(type: BackupType, adminId: string) {
  const record = await prisma.backupRecord.create({ data: { tipo: type, createdBy: adminId } });
  try {
    await fsp.mkdir(backupRoot(), { recursive: true });
    await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL)").catch(() => undefined);
    const extension = type === "database" ? "db" : "zip";
    const fileName = `global-norte-${type}-${timestamp()}.${extension}`;
    const filePath = path.join(backupRoot(), fileName);

    if (type === "database") await fsp.copyFile(sqlitePath(), filePath);
    else await createZip(filePath, type);

    const stat = await fsp.stat(filePath);
    const completed = await prisma.backupRecord.update({
      where: { id: record.id },
      data: { fileName, filePath, size: stat.size, checksum: await checksum(filePath), estado: "completado", completedAt: new Date() },
    });
    await prisma.activityLog.create({ data: { userId: adminId, accion: "backup_generado", modulo: "backups", detalle: `${type}: ${fileName} (${stat.size} bytes)` } });
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el backup";
    await prisma.backupRecord.update({ where: { id: record.id }, data: { estado: "error", error: message, completedAt: new Date() } });
    throw error;
  }
}

export async function backupDownload(id: string) {
  const record = await prisma.backupRecord.findUnique({ where: { id } });
  if (!record?.filePath || record.estado !== "completado") return null;
  const resolved = path.resolve(record.filePath);
  const root = backupRoot();
  if (!resolved.startsWith(`${root}${path.sep}`)) return null;
  const file = await fsp.readFile(resolved).catch(() => null);
  return file && record.fileName ? { record, file } : null;
}

function assertInside(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Ruta de restauracion no permitida");
  }
}

async function copyDirectory(source: string, target: string) {
  const exists = await fsp.stat(source).then((stat) => stat.isDirectory()).catch(() => false);
  if (!exists) return;
  await fsp.mkdir(target, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await fsp.copyFile(from, to);
  }
}

export async function inspectBackupZip(buffer: Buffer): Promise<RestorePlan> {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().map((entry) => entry.entryName);
  const manifestEntry = zip.getEntry("manifest.json");
  const summary = manifestEntry ? JSON.parse(manifestEntry.getData().toString("utf8")) : {};
  const errors: string[] = [];
  if (!manifestEntry) errors.push("No contiene manifest.json");
  if (!entries.includes("database/globalnorte.db")) errors.push("No contiene database/globalnorte.db");
  if (entries.some((entry) => entry.includes("..") || path.isAbsolute(entry))) errors.push("El ZIP contiene rutas no permitidas");
  return { ok: errors.length === 0, summary, errors };
}

export async function restoreBackupZip(buffer: Buffer, adminId: string) {
  const plan = await inspectBackupZip(buffer);
  if (!plan.ok) throw new Error(plan.errors.join(". "));
  const before = await generateBackup("complete", adminId);
  const zip = new AdmZip(buffer);
  const tempRoot = path.join(backupRoot(), `restore-${Date.now()}`);
  await fsp.mkdir(tempRoot, { recursive: true });
  zip.extractAllTo(tempRoot, true);

  const dbSource = path.join(tempRoot, "database", "globalnorte.db");
  const uploadSource = path.join(tempRoot, "uploads");
  const pdfSource = path.join(tempRoot, "pdfs");
  const uploadTarget = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  const pdfTarget = path.resolve(process.env.PDF_DIR ?? "./public/pdfs");
  assertInside(process.cwd(), uploadTarget);
  assertInside(process.cwd(), pdfTarget);

  await prisma.$disconnect();
  await fsp.copyFile(dbSource, sqlitePath());
  await copyDirectory(uploadSource, uploadTarget);
  await copyDirectory(pdfSource, pdfTarget);
  await fsp.rm(tempRoot, { recursive: true, force: true });
  return { restored: true, preRestoreBackup: before.fileName, restartRequired: true, summary: plan.summary };
}

export async function backupStats() {
  const lastBackup = await prisma.backupRecord.findFirst({ where: { estado: "completado" }, orderBy: { completedAt: "desc" } });
  return { lastBackup, backupDir: backupRoot() };
}
