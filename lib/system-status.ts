import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { backupStats, sqlitePath } from "@/lib/backups";

const execFileAsync = promisify(execFile);

async function sizeOf(target: string): Promise<number> {
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  const entries = await fsp.readdir(target, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) total += await sizeOf(path.join(target, entry.name));
  return total;
}

async function fileExists(publicPath?: string | null) {
  if (!publicPath?.startsWith("/uploads/") && !publicPath?.startsWith("/brand/")) return false;
  const full = path.resolve(process.cwd(), "public", publicPath.replace(/^\//, ""));
  const publicRoot = path.resolve(process.cwd(), "public");
  if (!full.startsWith(`${publicRoot}${path.sep}`)) return false;
  return fsp.stat(full).then((stat) => stat.isFile()).catch(() => false);
}

async function gitCommit() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd(), timeout: 3000 });
    return stdout.trim();
  } catch {
    return "desconocido";
  }
}

async function imageAuditSummary() {
  const products = await prisma.product.findMany({ select: { id: true, codigoInterno: true, nombre: true, imagenPrincipal: true } });
  const broken: Array<{ id: string; codigoInterno: string; nombre: string; imagenPrincipal: string | null }> = [];
  let picsum = 0;
  let missing = 0;
  for (const product of products) {
    if (product.imagenPrincipal?.includes("picsum.photos")) picsum += 1;
    if (!product.imagenPrincipal) {
      missing += 1;
      continue;
    }
    if (product.imagenPrincipal.startsWith("/uploads/") && !(await fileExists(product.imagenPrincipal))) {
      broken.push(product);
    }
  }
  return { totalProducts: products.length, missing, picsum, brokenCount: broken.length, broken: broken.slice(0, 50) };
}

export async function systemStatus() {
  const dbPath = sqlitePath();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  const pdfDir = path.resolve(process.env.PDF_DIR ?? "./public/pdfs");
  const [{ lastBackup, backupDir }, images, counts] = await Promise.all([
    backupStats(),
    imageAuditSummary(),
    Promise.all([
      prisma.product.count(),
      prisma.category.count(),
      prisma.brand.count(),
      prisma.user.count({ where: { rol: "cliente" } }),
      prisma.adminUser.count(),
      prisma.order.count(),
      prisma.mediaAsset.count(),
      prisma.coupon.count(),
      prisma.bonus.count(),
      prisma.notification.count(),
      prisma.banner.count(),
      prisma.activityLog.count(),
    ]),
  ]);
  const [products, categories, brands, clients, adminUsers, orders, mediaAssets, coupons, bonuses, notifications, banners, logs] = counts;
  return {
    app: {
      name: "Global Norte",
      version: process.env.npm_package_version ?? "0.1.0",
      commit: await gitCommit(),
      uptimeSeconds: Math.round(process.uptime()),
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
    database: {
      provider: "sqlite",
      url: process.env.DATABASE_URL ?? "file:../data/globalnorte.db",
      path: dbPath,
      size: await sizeOf(dbPath),
      exists: await fsp.stat(dbPath).then((stat) => stat.isFile()).catch(() => false),
    },
    storage: {
      uploads: { path: uploadDir, exists: await fsp.stat(uploadDir).then((stat) => stat.isDirectory()).catch(() => false), size: await sizeOf(uploadDir) },
      pdfs: { path: pdfDir, exists: await fsp.stat(pdfDir).then((stat) => stat.isDirectory()).catch(() => false), size: await sizeOf(pdfDir) },
      backups: { path: backupDir, exists: await fsp.stat(backupDir).then((stat) => stat.isDirectory()).catch(() => false), lastBackup },
    },
    counts: { products, categories, brands, clients, adminUsers, orders, mediaAssets, coupons, bonuses, notifications, banners, logs },
    images,
    runtime: {
      pm2: { detected: Boolean(process.env.pm_id), id: process.env.pm_id ?? null, name: process.env.name ?? process.env.pm_name ?? null },
      vps: { platform: process.platform, cwd: process.cwd() },
    },
  };
}
