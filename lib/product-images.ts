import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Prisma, Product, ProductImageCandidate } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeSlug } from "@/lib/format";

export type ProductWithImageContext = Product & {
  brand?: { nombre: string } | null;
  category?: { nombre: string; imagen?: string | null } | null;
};

export type ImageCandidateInput = {
  imageUrlOriginal: string;
  localPath?: string | null;
  sourceUrl?: string | null;
  sourceName: string;
  confidence?: number;
  status?: "pending" | "approved" | "rejected" | "auto_approved";
};

export type ImageImportResult = {
  codigoInterno: string;
  ok: boolean;
  localPath?: string;
  status?: string;
  error?: string;
};

const VALID_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const AUTO_DIR = path.join(process.cwd(), "public", "uploads", "products", "auto");
const MAX_DOWNLOAD_BYTES = Number(process.env.PRODUCT_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);
const DOWNLOAD_TIMEOUT = Number(process.env.PRODUCT_IMAGE_TIMEOUT_MS ?? 15000);
const AUTO_APPROVE_THRESHOLD = Number(process.env.PRODUCT_IMAGE_AUTO_APPROVE_THRESHOLD ?? 68);

export function isFakeProductImage(src?: string | null) {
  const value = src?.trim().toLowerCase() ?? "";
  return !value || value.includes("picsum.photos") || value.includes("/brand/product-placeholder") || value.includes("placeholder");
}

export function isLocalProductImage(src?: string | null) {
  return Boolean(src?.startsWith("/uploads/products/") || src?.startsWith("/uploads/productos/"));
}

export async function localImageExists(src?: string | null) {
  if (!src?.startsWith("/uploads/")) return false;
  const full = path.join(process.cwd(), "public", src.replace(/^\//, ""));
  try {
    const stat = await fs.stat(full);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function productNeedsImage(product: Pick<Product, "imagenPrincipal">) {
  if (isFakeProductImage(product.imagenPrincipal)) return true;
  if (!isLocalProductImage(product.imagenPrincipal)) return true;
  return !(await localImageExists(product.imagenPrincipal));
}

export async function productsNeedingImages(limit = 30) {
  const products = await prisma.product.findMany({
    where: { activo: true },
    include: { brand: true, category: true },
    orderBy: { codigoInterno: "asc" },
    take: Math.max(1, Math.min(limit * 4, 500)),
  });
  const result: ProductWithImageContext[] = [];
  for (const product of products) {
    if (await productNeedsImage(product)) result.push(product);
    if (result.length >= limit) break;
  }
  return result;
}

function safeFileName(product: Pick<Product, "codigoInterno" | "nombre">) {
  return `${product.codigoInterno.replace(/[^a-z0-9_-]/gi, "")}-${makeSlug(product.nombre).slice(0, 72) || "producto"}.webp`.toLowerCase();
}

function imagePathForProduct(product: Pick<Product, "codigoInterno" | "nombre">) {
  return {
    localPath: `/uploads/products/auto/${safeFileName(product)}`,
    fullPath: path.join(AUTO_DIR, safeFileName(product)),
  };
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = DOWNLOAD_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function normalize(text?: string | null) {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function productTokens(product: ProductWithImageContext) {
  const stop = new Set(["de", "del", "la", "el", "en", "x", "por", "con", "gr", "kg", "lt", "litro", "ml", "unidad", "producto"]);
  return normalize(`${product.nombre} ${product.brand?.nombre ?? ""}`)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stop.has(token) && !/^\d+$/.test(token))
    .slice(0, 8);
}

export function estimateConfidence(product: ProductWithImageContext, text: string) {
  const haystack = normalize(text);
  const tokens = productTokens(product);
  if (!tokens.length) return 35;
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  const brandBoost = product.brand?.nombre && haystack.includes(normalize(product.brand.nombre)) ? 16 : 0;
  const nameBoost = normalize(product.nombre).split(/\s+/).slice(0, 2).every((token) => haystack.includes(token)) ? 12 : 0;
  return Math.min(98, Math.round(35 + (matched / tokens.length) * 35 + brandBoost + nameBoost));
}

function rejectExternalImage(url: string) {
  const value = url.toLowerCase();
  return value.includes("picsum.photos") || value.includes("base64,") || value.startsWith("data:");
}

export async function downloadProductImage(product: Pick<Product, "id" | "codigoInterno" | "nombre">, imageUrl: string, sourceName: string) {
  if (rejectExternalImage(imageUrl)) throw new Error("Fuente de imagen no permitida");
  await fs.mkdir(AUTO_DIR, { recursive: true });
  const { localPath, fullPath } = imagePathForProduct(product);
  const buffer = await withTimeout(async (signal) => {
    const response = await fetch(imageUrl, {
      signal,
      headers: {
        "User-Agent": "GlobalNorteImageBot/1.0 (+https://globalnorte.local)",
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`Descarga fallida ${response.status}`);
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (type && !VALID_IMAGE_TYPES.has(type)) throw new Error(`Tipo no permitido: ${type}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_DOWNLOAD_BYTES) throw new Error("Imagen demasiado grande");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error("Imagen demasiado grande");
    return bytes;
  });
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Archivo de imagen invalido");
  if (metadata.width < 120 || metadata.height < 120) throw new Error("Imagen demasiado pequena");
  await sharp(buffer)
    .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true, background: "#ffffff" })
    .webp({ quality: 84 })
    .toFile(fullPath);
  const stat = await fs.stat(fullPath);
  await prisma.mediaAsset.upsert({
    where: { path: localPath },
    create: {
      path: localPath,
      originalName: path.basename(imageUrl.split("?")[0]) || `${product.codigoInterno}.webp`,
      mimeType: "image/webp",
      size: stat.size,
      width: metadata.width,
      height: metadata.height,
      folder: "products/auto",
      entityType: "product",
      entityId: product.id,
      createdBy: sourceName,
    },
    update: {
      originalName: path.basename(imageUrl.split("?")[0]) || `${product.codigoInterno}.webp`,
      mimeType: "image/webp",
      size: stat.size,
      width: metadata.width,
      height: metadata.height,
      folder: "products/auto",
      entityType: "product",
      entityId: product.id,
    },
  });
  return localPath;
}

export async function saveCandidate(product: ProductWithImageContext, input: ImageCandidateInput, updateProduct = true) {
  const confidence = Math.max(0, Math.min(100, Number(input.confidence ?? 0)));
  const status = input.status ?? (confidence >= AUTO_APPROVE_THRESHOLD ? "auto_approved" : "pending");
  const localPath = input.localPath ?? (await downloadProductImage(product, input.imageUrlOriginal, input.sourceName));
  const candidate = await prisma.productImageCandidate.create({
    data: {
      productId: product.id,
      imageUrlOriginal: input.imageUrlOriginal,
      localPath,
      sourceUrl: input.sourceUrl || input.imageUrlOriginal,
      sourceName: input.sourceName,
      confidence,
      status,
    },
  });
  if (updateProduct && (status === "auto_approved" || status === "approved")) {
    await prisma.product.update({
      where: { id: product.id },
      data: { imagenPrincipal: localPath, imagenes: JSON.stringify([localPath]) },
    });
  }
  return candidate;
}

async function searchEndpoint(product: ProductWithImageContext, query: string): Promise<ImageCandidateInput[]> {
  const endpoint = process.env.PRODUCT_IMAGE_SEARCH_ENDPOINT;
  if (!endpoint) return [];
  const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`;
  const response = await withTimeout((signal) => fetch(url, { signal }));
  if (!response.ok) return [];
  const data = (await response.json().catch(() => null)) as { results?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | null;
  const rows = Array.isArray(data) ? data : data?.results ?? [];
  return rows.flatMap((row) => {
    const image = String(row.imageUrl ?? row.image ?? row.thumbnailUrl ?? "");
    if (!image || rejectExternalImage(image)) return [];
    const sourceUrl = String(row.sourceUrl ?? row.url ?? image);
    const sourceName = String(row.sourceName ?? row.source ?? "Busqueda configurada");
    return [{ imageUrlOriginal: image, sourceUrl, sourceName, confidence: estimateConfidence(product, `${query} ${sourceUrl} ${sourceName}`) }];
  });
}

async function searchBing(product: ProductWithImageContext, query: string): Promise<ImageCandidateInput[]> {
  const key = process.env.BING_IMAGE_SEARCH_KEY;
  if (!key) return [];
  const response = await withTimeout((signal) =>
    fetch(`https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(query)}&count=6&safeSearch=Strict`, {
      signal,
      headers: { "Ocp-Apim-Subscription-Key": key },
    }),
  );
  if (!response.ok) return [];
  const data = (await response.json()) as { value?: Array<{ contentUrl?: string; hostPageUrl?: string; name?: string; hostPageDisplayUrl?: string }> };
  return (data.value ?? []).flatMap((item) => {
    if (!item.contentUrl || rejectExternalImage(item.contentUrl)) return [];
    const text = `${query} ${item.name ?? ""} ${item.hostPageDisplayUrl ?? ""}`;
    return [{ imageUrlOriginal: item.contentUrl, sourceUrl: item.hostPageUrl ?? item.contentUrl, sourceName: "Bing Image Search", confidence: estimateConfidence(product, text) }];
  });
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\\u002f/g, "/")
    .replace(/\\\//g, "/");
}

async function searchBingHtml(product: ProductWithImageContext, query: string): Promise<ImageCandidateInput[]> {
  if (process.env.PRODUCT_IMAGE_ENABLE_BING_HTML === "false") return [];
  const html = await withTimeout(async (signal) => {
    const response = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 GlobalNorteImageBot/1.0", Accept: "text/html" },
    });
    return response.ok ? response.text() : "";
  }, 12000);
  const decoded = decodeHtml(html);
  const results: ImageCandidateInput[] = [];
  const regex = /"purl":"(.*?)".{0,1200}?"murl":"(.*?)"|"murl":"(.*?)".{0,1200}?"purl":"(.*?)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(decoded)) && results.length < 8) {
    const sourceUrl = decodeHtml(match[1] || match[4] || "");
    const imageUrlOriginal = decodeHtml(match[2] || match[3] || "");
    if (!imageUrlOriginal || rejectExternalImage(imageUrlOriginal)) continue;
    const sourceName = (() => {
      try {
        return `Bing HTML: ${new URL(sourceUrl).hostname.replace(/^www\./, "")}`;
      } catch {
        return "Bing HTML";
      }
    })();
    results.push({
      imageUrlOriginal,
      sourceUrl,
      sourceName,
      confidence: estimateConfidence(product, `${query} ${sourceUrl} ${imageUrlOriginal}`),
    });
  }
  return results;
}

async function searchDuckDuckGo(product: ProductWithImageContext, query: string): Promise<ImageCandidateInput[]> {
  if (process.env.PRODUCT_IMAGE_ENABLE_DUCKDUCKGO === "false") return [];
  const page = await withTimeout(async (signal) => {
    const response = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 GlobalNorteImageBot/1.0" },
    });
    return response.ok ? response.text() : "";
  });
  const vqd = page.match(/vqd=["']?([^&"']+)/)?.[1];
  if (!vqd) return [];
  const response = await withTimeout((signal) =>
    fetch(`https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 GlobalNorteImageBot/1.0", Referer: "https://duckduckgo.com/" },
    }),
  );
  if (!response.ok) return [];
  const data = (await response.json().catch(() => null)) as { results?: Array<{ image?: string; url?: string; title?: string; source?: string }> } | null;
  return (data?.results ?? []).slice(0, 8).flatMap((item) => {
    if (!item.image || rejectExternalImage(item.image)) return [];
    const text = `${query} ${item.title ?? ""} ${item.url ?? ""} ${item.source ?? ""}`;
    return [{ imageUrlOriginal: item.image, sourceUrl: item.url ?? item.image, sourceName: item.source ? `DuckDuckGo: ${item.source}` : "DuckDuckGo Images", confidence: estimateConfidence(product, text) }];
  });
}

export function queriesForProduct(product: ProductWithImageContext) {
  const brand = product.brand?.nombre ? ` ${product.brand.nombre}` : "";
  return [
    `${product.nombre}${brand} producto`,
    `${product.nombre} producto Peru`,
    `${product.nombre} imagen producto`,
  ];
}

export async function findProductImageCandidates(product: ProductWithImageContext) {
  const candidates: ImageCandidateInput[] = [];
  async function collect(provider: () => Promise<ImageCandidateInput[]>) {
    try {
      candidates.push(...(await provider()));
    } catch (error) {
      if (process.env.PRODUCT_IMAGE_DEBUG === "true") {
        console.warn("[product-images] proveedor fallo", error);
      }
    }
  }
  for (const query of queriesForProduct(product)) {
    await collect(() => searchEndpoint(product, query));
    await collect(() => searchBing(product, query));
    await collect(() => searchBingHtml(product, query));
    await collect(() => searchDuckDuckGo(product, query));
    if (candidates.length >= 4) break;
  }
  const seen = new Set<string>();
  return candidates
    .filter((item) => {
      if (!item.imageUrlOriginal || seen.has(item.imageUrlOriginal)) return false;
      seen.add(item.imageUrlOriginal);
      return true;
    })
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

export async function fetchImagesForProducts(limit = 30) {
  const products = await productsNeedingImages(limit);
  const results: ImageImportResult[] = [];
  for (const product of products) {
    try {
      const candidates = await findProductImageCandidates(product);
      if (!candidates.length) {
        results.push({ codigoInterno: product.codigoInterno, ok: false, error: "Sin candidato encontrado" });
        continue;
      }
      let saved: ProductImageCandidate | null = null;
      let lastError = "";
      for (const candidate of candidates) {
        try {
          saved = await saveCandidate(product, candidate);
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Error al descargar candidato";
        }
      }
      if (!saved) {
        results.push({ codigoInterno: product.codigoInterno, ok: false, error: lastError || "No se pudo descargar ningun candidato" });
        continue;
      }
      results.push({ codigoInterno: product.codigoInterno, ok: true, localPath: saved.localPath ?? undefined, status: saved.status });
    } catch (error) {
      results.push({ codigoInterno: product.codigoInterno, ok: false, error: error instanceof Error ? error.message : "Error desconocido" });
    }
  }
  return { scanned: products.length, populated: results.filter((item) => item.ok && item.localPath).length, results };
}

export function parseImageCsv(csv: string) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const [headerLine, ...rows] = lines;
  const headers = headerLine.split(",").map((item) => item.trim());
  return rows.map((line) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);
    const clean = cells.slice(0, headers.length).map((cell) => cell.trim());
    return Object.fromEntries(headers.map((header, index) => [header, clean[index] ?? ""])) as Record<string, string>;
  });
}

export async function importProductImageCsv(csv: string) {
  const rows = parseImageCsv(csv);
  const results: ImageImportResult[] = [];
  for (const row of rows) {
    const codigoInterno = (row.codigoInterno ?? "").trim();
    try {
      if (!codigoInterno || !row.imageUrl) throw new Error("codigoInterno e imageUrl son obligatorios");
      const product = await prisma.product.findUnique({ where: { codigoInterno }, include: { brand: true, category: true } });
      if (!product) throw new Error("Producto no encontrado");
      const confidence = estimateConfidence(product, `${row.imageUrl} ${row.sourceUrl ?? ""} ${row.sourceName ?? ""} ${product.nombre}`);
      const saved = await saveCandidate(product, {
        imageUrlOriginal: row.imageUrl,
        sourceUrl: row.sourceUrl || row.imageUrl,
        sourceName: row.sourceName || "CSV",
        confidence: Math.max(confidence, 85),
        status: "approved",
      });
      results.push({ codigoInterno, ok: true, localPath: saved.localPath ?? undefined, status: saved.status });
    } catch (error) {
      results.push({ codigoInterno, ok: false, error: error instanceof Error ? error.message : "Error desconocido" });
    }
  }
  return { total: rows.length, imported: results.filter((item) => item.ok).length, results };
}

export async function approveImageCandidate(id: string) {
  const candidate = await prisma.productImageCandidate.update({ where: { id }, data: { status: "approved" }, include: { product: true } });
  if (!candidate.localPath) throw new Error("El candidato no tiene archivo local");
  await prisma.product.update({ where: { id: candidate.productId }, data: { imagenPrincipal: candidate.localPath, imagenes: JSON.stringify([candidate.localPath]) } });
  return candidate;
}

export async function rejectImageCandidate(id: string) {
  return prisma.productImageCandidate.update({ where: { id }, data: { status: "rejected" } });
}

export async function adminImageDashboard() {
  const [pending, missingProducts, stats] = await Promise.all([
    prisma.productImageCandidate.findMany({ where: { status: "pending" }, include: { product: { include: { brand: true, category: true } } }, orderBy: [{ confidence: "desc" }, { createdAt: "desc" }], take: 100 }),
    productsNeedingImages(100),
    prisma.productImageCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    pending,
    missingProducts,
    stats: Object.fromEntries(stats.map((item) => [item.status, item._count._all])),
  };
}

export async function registerManualProductImage(productId: string, localPath: string, sourceName = "Subida manual admin") {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { brand: true, category: true } });
  if (!product) throw new Error("Producto no encontrado");
  const candidate = await prisma.productImageCandidate.create({
    data: {
      productId,
      imageUrlOriginal: localPath,
      localPath,
      sourceUrl: localPath,
      sourceName,
      confidence: 100,
      status: "approved",
    },
  });
  await prisma.product.update({ where: { id: productId }, data: { imagenPrincipal: localPath, imagenes: JSON.stringify([localPath]) } });
  await prisma.mediaAsset.updateMany({ where: { path: localPath }, data: { entityType: "product", entityId: productId } });
  return candidate;
}

export async function retryProductImageSearch(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { brand: true, category: true } });
  if (!product) throw new Error("Producto no encontrado");
  const [candidate] = await findProductImageCandidates(product);
  if (!candidate) throw new Error("No se encontro imagen sugerida");
  return saveCandidate(product, candidate);
}

export type ProductImageCandidateWithProduct = Prisma.ProductImageCandidateGetPayload<{
  include: { product: { include: { brand: true; category: true } } };
}>;
