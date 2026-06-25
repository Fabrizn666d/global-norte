import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/db";

export type BackupType = "database" | "uploads" | "pdfs" | "complete";

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

async function createZip(filePath: string, type: BackupType) {
  const archive = new AdmZip();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  const pdfDir = path.resolve(process.env.PDF_DIR ?? "./public/pdfs");
  if (type === "uploads" || type === "complete") await addDirectory(archive, uploadDir, "uploads");
  if (type === "pdfs" || type === "complete") await addDirectory(archive, pdfDir, "pdfs");
  if (type === "complete") archive.addLocalFile(sqlitePath(), "database", "globalnorte.db");
  archive.addFile("manifest.json", Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), type, database: "SQLite", restore: "Consulta RESTORE-BACKUP.md incluido en el proyecto." }, null, 2)));
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
