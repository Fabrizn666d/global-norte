import fsp from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/db";

type CatalogPayload = {
  version: number;
  exportedAt: string;
  categories: any[];
  brands: any[];
  products: any[];
  banners: any[];
  settings: any[];
  mediaAssets: any[];
};

const CATALOG_VERSION = 1;
const CATALOG_SETTING_GROUPS = new Set(["general", "contacto", "tienda", "pdf", "social", "pedidos"]);

function safeZipPath(filePath: string) {
  return filePath.replace(/^\/+/, "").replace(/\\/g, "/");
}

function localPublicPath(publicPath?: string | null) {
  if (!publicPath?.startsWith("/uploads/") && !publicPath?.startsWith("/brand/")) return null;
  const full = path.resolve(process.cwd(), "public", publicPath.replace(/^\//, ""));
  const publicRoot = path.resolve(process.cwd(), "public");
  if (!full.startsWith(`${publicRoot}${path.sep}`)) return null;
  return full;
}

async function addFileIfExists(zip: AdmZip, publicPath?: string | null) {
  const full = localPublicPath(publicPath);
  if (!full) return;
  const exists = await fsp.stat(full).then((stat) => stat.isFile()).catch(() => false);
  if (exists) zip.addLocalFile(full, path.dirname(safeZipPath(publicPath!)));
}

export async function exportCatalogZip() {
  const [categories, brands, products, banners, settings, mediaAssets] = await Promise.all([
    prisma.category.findMany({ include: { padre: true }, orderBy: { orden: "asc" } }),
    prisma.brand.findMany({ orderBy: { orden: "asc" } }),
    prisma.product.findMany({ include: { category: true, brand: true }, orderBy: { codigoInterno: "asc" } }),
    prisma.banner.findMany({ orderBy: { orden: "asc" } }),
    prisma.setting.findMany({ where: { grupo: { in: Array.from(CATALOG_SETTING_GROUPS) } }, orderBy: [{ grupo: "asc" }, { clave: "asc" }] }),
    prisma.mediaAsset.findMany({ where: { OR: [{ entityType: "product" }, { entityType: "banner" }, { entityType: "brand" }, { entityType: "category" }] } }),
  ]);
  const payload: CatalogPayload = {
    version: CATALOG_VERSION,
    exportedAt: new Date().toISOString(),
    categories: categories.map(({ padre, ...category }) => ({ ...category, padreSlug: padre?.slug ?? null })),
    brands,
    products: products.map(({ category, brand, ...product }) => ({
      ...product,
      categorySlug: category.slug,
      brandSlug: brand?.slug ?? null,
    })),
    banners,
    settings,
    mediaAssets,
  };
  const zip = new AdmZip();
  zip.addFile("catalog.json", Buffer.from(JSON.stringify(payload, null, 2)));
  for (const category of categories) await addFileIfExists(zip, category.imagen);
  for (const brand of brands) await addFileIfExists(zip, brand.logo);
  for (const product of products) await addFileIfExists(zip, product.imagenPrincipal);
  for (const banner of banners) {
    await addFileIfExists(zip, banner.imagenDesktop);
    await addFileIfExists(zip, banner.imagenMobile);
  }
  for (const asset of mediaAssets) await addFileIfExists(zip, asset.path);
  return zip.toBuffer();
}

async function extractPublicFiles(zip: AdmZip) {
  const publicRoot = path.resolve(process.cwd(), "public");
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith("uploads/") && !entry.entryName.startsWith("brand/")) continue;
    if (entry.entryName.includes("..") || path.isAbsolute(entry.entryName)) throw new Error("Ruta invalida en catalogo");
    const target = path.resolve(publicRoot, entry.entryName);
    if (!target.startsWith(`${publicRoot}${path.sep}`)) throw new Error("Ruta invalida en catalogo");
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.getData());
  }
}

function cleanProduct(product: any, categoryId: string, brandId?: string | null) {
  return {
    codigoInterno: String(product.codigoInterno),
    nombre: String(product.nombre),
    slug: String(product.slug),
    descripcion: product.descripcion ?? null,
    categoryId,
    brandId: brandId ?? null,
    precioUnitario: Number(product.precioUnitario ?? 0),
    precioCaja: product.precioCaja === null || product.precioCaja === undefined ? null : Number(product.precioCaja),
    unidadesPorCaja: product.unidadesPorCaja === null || product.unidadesPorCaja === undefined ? null : Number(product.unidadesPorCaja),
    etiquetaCaja: product.etiquetaCaja ?? null,
    precioAnterior: product.precioAnterior === null || product.precioAnterior === undefined ? null : Number(product.precioAnterior),
    stock: Number(product.stock ?? 0),
    stockMinimo: Number(product.stockMinimo ?? 1),
    unidad: product.unidad ?? "unidad",
    imagenes: product.imagenes ?? "[]",
    imagenPrincipal: product.imagenPrincipal ?? null,
    activo: product.activo !== false,
    destacado: Boolean(product.destacado),
    mostrarEnHome: Boolean(product.mostrarEnHome),
    ordenDestacado: Number(product.ordenDestacado ?? 0),
    etiquetaDestacada: product.etiquetaDestacada ?? null,
    enOferta: Boolean(product.enOferta),
    nuevo: Boolean(product.nuevo),
    agotado: Boolean(product.agotado),
    tags: product.tags ?? "[]",
    seoTitulo: product.seoTitulo ?? null,
    seoDesc: product.seoDesc ?? null,
  };
}

export async function importCatalogZip(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("catalog.json");
  if (!entry) throw new Error("El ZIP no contiene catalog.json");
  const payload = JSON.parse(entry.getData().toString("utf8")) as CatalogPayload;
  if (payload.version !== CATALOG_VERSION) throw new Error("Version de catalogo no soportada");
  await extractPublicFiles(zip);

  const categoryMap = new Map<string, string>();
  const brandMap = new Map<string, string>();

  for (const category of payload.categories ?? []) {
    const saved = await prisma.category.upsert({
      where: { slug: category.slug },
      create: {
        nombre: category.nombre,
        slug: category.slug,
        descripcion: category.descripcion,
        imagen: category.imagen,
        icono: category.icono,
        padreId: null,
        orden: Number(category.orden ?? 0),
        activo: category.activo !== false,
      },
      update: {
        nombre: category.nombre,
        descripcion: category.descripcion,
        imagen: category.imagen,
        icono: category.icono,
        orden: Number(category.orden ?? 0),
        activo: category.activo !== false,
      },
    });
    categoryMap.set(category.slug, saved.id);
  }

  for (const category of payload.categories ?? []) {
    if (!category.padreSlug) continue;
    const id = categoryMap.get(category.slug);
    const padreId = categoryMap.get(category.padreSlug);
    if (id && padreId && id !== padreId) await prisma.category.update({ where: { id }, data: { padreId } });
  }

  for (const brand of payload.brands ?? []) {
    const saved = await prisma.brand.upsert({
      where: { slug: brand.slug },
      create: { nombre: brand.nombre, slug: brand.slug, logo: brand.logo, descripcion: brand.descripcion, destacada: Boolean(brand.destacada), orden: Number(brand.orden ?? 0), activo: brand.activo !== false },
      update: { nombre: brand.nombre, logo: brand.logo, descripcion: brand.descripcion, destacada: Boolean(brand.destacada), orden: Number(brand.orden ?? 0), activo: brand.activo !== false },
    });
    brandMap.set(brand.slug, saved.id);
  }

  let products = 0;
  for (const product of payload.products ?? []) {
    const categoryId = categoryMap.get(product.categorySlug);
    if (!categoryId) continue;
    const brandId = product.brandSlug ? brandMap.get(product.brandSlug) ?? null : null;
    await prisma.product.upsert({
      where: { codigoInterno: product.codigoInterno },
      create: cleanProduct(product, categoryId, brandId),
      update: cleanProduct(product, categoryId, brandId),
    });
    products += 1;
  }

  let banners = 0;
  for (const banner of payload.banners ?? []) {
    await prisma.banner.upsert({
      where: { id: banner.id },
      create: {
        id: banner.id,
        titulo: banner.titulo,
        subtitulo: banner.subtitulo,
        descripcion: banner.descripcion,
        ctaTexto: banner.ctaTexto,
        ctaLink: banner.ctaLink,
        imagenDesktop: banner.imagenDesktop,
        imagenMobile: banner.imagenMobile,
        posicion: banner.posicion,
        tipo: banner.tipo,
        colorTexto: banner.colorTexto,
        activo: banner.activo !== false,
        orden: Number(banner.orden ?? 0),
        fechaInicio: banner.fechaInicio ? new Date(banner.fechaInicio) : null,
        fechaFin: banner.fechaFin ? new Date(banner.fechaFin) : null,
      },
      update: {
        titulo: banner.titulo,
        subtitulo: banner.subtitulo,
        descripcion: banner.descripcion,
        ctaTexto: banner.ctaTexto,
        ctaLink: banner.ctaLink,
        imagenDesktop: banner.imagenDesktop,
        imagenMobile: banner.imagenMobile,
        posicion: banner.posicion,
        tipo: banner.tipo,
        colorTexto: banner.colorTexto,
        activo: banner.activo !== false,
        orden: Number(banner.orden ?? 0),
        fechaInicio: banner.fechaInicio ? new Date(banner.fechaInicio) : null,
        fechaFin: banner.fechaFin ? new Date(banner.fechaFin) : null,
      },
    });
    banners += 1;
  }

  let settings = 0;
  for (const setting of payload.settings ?? []) {
    if (!CATALOG_SETTING_GROUPS.has(setting.grupo ?? "")) continue;
    await prisma.setting.upsert({
      where: { clave: setting.clave },
      create: { clave: setting.clave, valor: setting.valor, tipo: setting.tipo ?? "string", grupo: setting.grupo ?? "general", label: setting.label },
      update: { valor: setting.valor, tipo: setting.tipo ?? "string", grupo: setting.grupo ?? "general", label: setting.label },
    });
    settings += 1;
  }

  for (const asset of payload.mediaAssets ?? []) {
    if (!asset.path?.startsWith("/uploads/")) continue;
    await prisma.mediaAsset.upsert({
      where: { path: asset.path },
      create: {
        path: asset.path,
        originalName: asset.originalName ?? path.basename(asset.path),
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: Number(asset.size ?? 0),
        width: asset.width ?? null,
        height: asset.height ?? null,
        folder: asset.folder ?? asset.path.split("/")[2] ?? "uploads",
        entityType: asset.entityType ?? null,
        entityId: asset.entityId ?? null,
        createdBy: asset.createdBy ?? "catalog-import",
      },
      update: {
        originalName: asset.originalName ?? path.basename(asset.path),
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: Number(asset.size ?? 0),
        width: asset.width ?? null,
        height: asset.height ?? null,
        folder: asset.folder ?? asset.path.split("/")[2] ?? "uploads",
        entityType: asset.entityType ?? null,
        entityId: asset.entityId ?? null,
      },
    });
  }

  return {
    imported: true,
    categories: categoryMap.size,
    brands: brandMap.size,
    products,
    banners,
    settings,
    skippedSensitiveData: ["clientes", "usuarios", "pedidos", "historial", "logs"],
  };
}
