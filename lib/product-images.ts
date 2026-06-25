import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { Prisma, Product, ProductImageJob } from "@prisma/client";
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

export type ImageProcessOptions = {
  limit?: number;
  all?: boolean;
  retryErrors?: boolean;
  repairBroken?: boolean;
};

const VALID_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const AUTO_DIR = path.join(process.cwd(), "public", "uploads", "products", "auto");
const MAX_DOWNLOAD_BYTES = Number(process.env.PRODUCT_IMAGE_MAX_BYTES ?? 8 * 1024 * 1024);
const DOWNLOAD_TIMEOUT = Number(process.env.PRODUCT_IMAGE_TIMEOUT_MS ?? 15000);
const AUTO_APPROVE_THRESHOLD = Number(process.env.PRODUCT_IMAGE_AUTO_APPROVE_THRESHOLD ?? 92);
const MIN_IMAGE_WIDTH = Number(process.env.PRODUCT_IMAGE_MIN_WIDTH ?? 240);
const MIN_IMAGE_HEIGHT = Number(process.env.PRODUCT_IMAGE_MIN_HEIGHT ?? 240);

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

function isProbablyBadImageUrl(url: string) {
  const value = url.toLowerCase();
  return /(logo|logotipo|banner|icon|favicon|placeholder|sprite|marca)/i.test(value);
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

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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
  if (isProbablyBadImageUrl(imageUrl)) throw new Error("URL parece logo/banner/placeholder");
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
  if (metadata.width < MIN_IMAGE_WIDTH || metadata.height < MIN_IMAGE_HEIGHT) throw new Error("Imagen demasiado pequena");
  const aspect = metadata.width / metadata.height;
  if (aspect < 0.45 || aspect > 2.25) throw new Error("Proporcion no parece producto");
  const stats = await sharp(buffer).stats().catch(() => null);
  const variation = stats?.channels.reduce((sum, channel) => sum + channel.stdev, 0) ?? 0;
  if (variation > 0 && variation < 18) throw new Error("Imagen con poca informacion visual");
  await sharp(buffer)
    .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true, background: "#ffffff" })
    .webp({ quality: 84 })
    .toFile(fullPath);
  const [stat, output] = await Promise.all([fs.stat(fullPath), fs.readFile(fullPath)]);
  const contentHash = sha256(output);
  const duplicate = await prisma.mediaAsset.findFirst({ where: { checksum: contentHash, entityType: "product", entityId: { not: product.id } } });
  if (duplicate) {
    await fs.rm(fullPath, { force: true }).catch(() => undefined);
    throw new Error(`Imagen duplicada de otro producto: ${duplicate.path}`);
  }
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
      checksum: contentHash,
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
      checksum: contentHash,
    },
  });
  return { localPath, contentHash, width: metadata.width, height: metadata.height, fileSize: stat.size };
}

const NEGATIVE_IMAGE_TERMS = [
  "mujer", "hombre", "persona", "personas", "rostro", "face", "selfie", "modelo", "actriz", "actor", "celebridad", "biografia",
  "paisaje", "turismo", "turistico", "playa", "montana", "montaña", "hotel", "resort", "viaje", "travel", "ruinas", "parque",
  "cancha deportiva", "futbol", "football", "estadio", "deporte", "deportivo", "basket", "voley", "tenis",
  "casa", "edificio", "arquitectura", "interior", "habitacion", "mueble", "sofa", "mesa", "silla", "decoracion",
  "meme", "poster", "pelicula", "movie", "cartel", "wallpaper", "youtube", "thumbnail", "video", "trailer",
  "auto", "carro", "vehiculo", "moto", "mapa", "logo", "logotipo", "favicon", "sprite", "placeholder",
];

const POSITIVE_PRODUCT_TERMS = [
  "producto", "pack", "presentacion", "presentación", "sachet", "sobre", "botella", "bolsa", "caja", "lata", "envase",
  "display", "unidad", "supermercado", "tienda", "abarrotes", "mayorista", "comprar", "venta", "precio",
  "plazavea", "plaza vea", "tottus", "wong", "metro", "vivanda", "makro", "mayorsa", "promart", "vea",
  "alicorp", "molitalia", "sibarita", "anita", "gloria", "sapolio", "bolivar", "colgate", "procter", "unilever",
];

function containsAny(haystack: string, terms: string[]) {
  return terms.some((term) => haystack.includes(normalize(term)));
}

function cleanProductName(name: string) {
  return name
    .replace(/\bAGRANEL\b/gi, "")
    .replace(/\bADULTO\b/gi, "")
    .replace(/\bEXTRA\b/gi, "")
    .replace(/\bDE\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function productContextText(product: ProductWithImageContext, candidate: Pick<ImageCandidateInput, "imageUrlOriginal" | "sourceUrl" | "sourceName">, query?: string) {
  return normalize([
    product.nombre,
    product.brand?.nombre,
    product.category?.nombre,
    candidate.imageUrlOriginal,
    candidate.sourceUrl,
    candidate.sourceName,
    query,
  ].filter(Boolean).join(" "));
}

export function imageQualityAssessment(product: ProductWithImageContext, candidate: Pick<ImageCandidateInput, "imageUrlOriginal" | "sourceUrl" | "sourceName" | "confidence">, query?: string) {
  const text = productContextText(product, candidate, query);
  const candidateOnly = normalize(`${candidate.imageUrlOriginal} ${candidate.sourceUrl ?? ""} ${candidate.sourceName}`);
  const reasons: string[] = [];
  if (containsAny(candidateOnly, NEGATIVE_IMAGE_TERMS)) reasons.push("Fuente contiene señales de persona/paisaje/deporte/mueble/cartel/logo");
  if (normalize(product.brand?.nombre).includes("anita") && containsAny(candidateOnly, ["mujer", "rostro", "modelo", "biografia", "actriz"])) reasons.push("Marca Anita con resultado de persona");
  if (normalize(product.nombre).includes("cancha") && containsAny(candidateOnly, ["futbol", "estadio", "deportivo", "grass", "sports"])) reasons.push("Cancha interpretada como campo deportivo");
  if (/(oval|puerto|inka)/i.test(product.nombre) && containsAny(candidateOnly, ["turismo", "hotel", "playa", "viaje", "ruinas", "paisaje"])) reasons.push("Resultado turistico para nombre ambiguo");
  if (normalize(product.nombre).includes("bandido") && containsAny(candidateOnly, ["disfraz", "costume", "halloween", "persona", "pelicula"])) reasons.push("Bandido interpretado como disfraz/persona");
  if (normalize(product.nombre).includes("porcor") && containsAny(candidateOnly, ["mueble", "sofa", "mesa", "silla"])) reasons.push("Resultado de muebles");

  const tokens = productTokens(product).filter((token) => !["anita", "cancha", "bandido", "oval", "puerto", "inka"].includes(token));
  const matched = tokens.filter((token) => candidateOnly.includes(token)).length;
  const brandMatch = product.brand?.nombre ? candidateOnly.includes(normalize(product.brand.nombre)) : false;
  const positive = containsAny(candidateOnly, POSITIVE_PRODUCT_TERMS);
  const contextualPositive = containsAny(text, POSITIVE_PRODUCT_TERMS);
  const relevance = Math.min(100, (matched * 18) + (brandMatch ? 24 : 0) + (positive ? 24 : 0) + Math.min(20, Number(candidate.confidence ?? 0) / 5));
  if (tokens.length && matched === 0 && !brandMatch) reasons.push("No coincide con tokens fuertes del producto/marca");
  if (!positive && (!contextualPositive || relevance < 92)) reasons.push("No hay señales suficientes de producto empacado");
  return {
    ok: reasons.length === 0,
    autoApprovable: reasons.length === 0 && relevance >= 88 && Number(candidate.confidence ?? 0) >= AUTO_APPROVE_THRESHOLD,
    relevance: Math.round(relevance),
    reason: reasons.join("; "),
  };
}

export async function saveCandidate(product: ProductWithImageContext, input: ImageCandidateInput, updateProduct = true) {
  const confidence = Math.max(0, Math.min(100, Number(input.confidence ?? 0)));
  const quality = imageQualityAssessment(product, input);
  if (!quality.ok && input.status !== "approved") {
    await prisma.productImageCandidate.create({
      data: {
        productId: product.id,
        imageUrlOriginal: input.imageUrlOriginal,
        localPath: input.localPath ?? null,
        sourceUrl: input.sourceUrl || input.imageUrlOriginal,
        sourceName: input.sourceName,
        confidence,
        status: "rejected",
        error: quality.reason,
      },
    }).catch(() => undefined);
    throw new Error(`Imagen rechazada por calidad: ${quality.reason}`);
  }
  const status = input.status ?? (quality.autoApprovable ? "auto_approved" : "pending");
  const downloaded = input.localPath
    ? { localPath: input.localPath, contentHash: null, width: null, height: null, fileSize: null }
    : await downloadProductImage(product, input.imageUrlOriginal, input.sourceName);
  const localPath = downloaded.localPath;
  const candidate = await prisma.productImageCandidate.create({
    data: {
      productId: product.id,
      imageUrlOriginal: input.imageUrlOriginal,
      localPath,
      sourceUrl: input.sourceUrl || input.imageUrlOriginal,
      sourceName: input.sourceName,
      confidence,
      status,
      contentHash: downloaded.contentHash,
      width: downloaded.width,
      height: downloaded.height,
      fileSize: downloaded.fileSize,
      error: status === "pending" ? `Pendiente por confianza/calidad. Relevancia ${quality.relevance}` : null,
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
  const regex = /\{[^{}]{0,2500}?"purl":"(.*?)"[^{}]{0,2500}?"murl":"(.*?)"[^{}]{0,2500}?\}|\{[^{}]{0,2500}?"murl":"(.*?)"[^{}]{0,2500}?"purl":"(.*?)"[^{}]{0,2500}?\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(decoded)) && results.length < 8) {
    const sourceUrl = decodeHtml(match[1] || match[4] || "");
    const imageUrlOriginal = decodeHtml(match[2] || match[3] || "");
    if (!imageUrlOriginal || rejectExternalImage(imageUrlOriginal)) continue;
    const title = decodeHtml(match[0].match(/"t":"(.*?)"/)?.[1] ?? "");
    const sourceName = (() => {
      try {
        return `Bing HTML: ${new URL(sourceUrl).hostname.replace(/^www\./, "")}${title ? ` - ${title.slice(0, 90)}` : ""}`;
      } catch {
        return title ? `Bing HTML - ${title.slice(0, 90)}` : "Bing HTML";
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
  const compactName = cleanProductName(product.nombre);
  const shortBrand = product.brand?.nombre ? product.brand.nombre : "";
  const category = product.category?.nombre ? product.category.nombre : "";
  const firstTokens = product.nombre.split(/[\/\s-]+/).filter(Boolean).slice(0, 4).join(" ");
  const name = normalize(product.nombre);
  const baseNegative = ["-mujer", "-persona", "-rostro", "-paisaje", "-turismo", "-hotel", "-futbol", "-estadio", "-pelicula", "-poster", "-mueble", "-disfraz"];
  const negative = [...baseNegative, name.includes("cancha") ? "" : "-cancha"].filter(Boolean).join(" ");
  const special: string[] = [];
  const brandName = normalize(product.brand?.nombre);
  if (brandName.includes("anita")) special.push(`Anita alimentos Peru ${compactName} producto`, `Anita fideos condimentos ${compactName}`, `Anita Peru producto ${category}`);
  if (name.includes("cancha")) special.push(`${compactName} maiz cancha snack producto Peru`, `cancha chulpi maiz snack bolsa producto`);
  if (name.includes("bandido")) special.push(`${compactName} snack producto Peru`, `Bandido snack bolsa producto`);
  if (/(oval|puerto|inka)/i.test(product.nombre)) special.push(`${compactName} producto abarrotes Peru`, `${compactName} empaque producto`);
  if (name.includes("hh ss")) special.push(`${compactName} higiene personal sachet producto`, `${compactName} shampoo sachet producto Peru`);
  const queries = [
    ...special,
    `${shortBrand} ${category} producto`.trim(),
    `${shortBrand} ${compactName} producto Peru`.trim(),
    product.nombre,
    `${product.nombre} Peru`,
    `${product.nombre}${brand}`,
    `${product.nombre}${brand} producto`,
    `${product.nombre} producto Peru`,
    `${product.nombre} imagen producto`,
    compactName,
    `${firstTokens} ${shortBrand}`.trim(),
    shortBrand,
    `${shortBrand} producto`.trim(),
    category ? `${category} ${shortBrand} producto`.trim() : "",
    product.codigoInterno,
  ].filter((query, index, arr) => query && arr.indexOf(query) === index);
  return queries.map((query) => `${query} ${negative}`);
}

async function logImageAttempt(input: {
  productId: string;
  query?: string;
  sourceName: string;
  imageUrlOriginal?: string | null;
  sourceUrl?: string | null;
  result: string;
  error?: string;
  confidence?: number;
  localPath?: string | null;
  contentHash?: string | null;
}) {
  await prisma.productImageLog.create({
    data: {
      productId: input.productId,
      query: input.query,
      sourceName: input.sourceName,
      imageUrlOriginal: input.imageUrlOriginal,
      sourceUrl: input.sourceUrl,
      result: input.result,
      error: input.error,
      confidence: input.confidence ?? 0,
      localPath: input.localPath,
      contentHash: input.contentHash,
    },
  }).catch(() => undefined);
}

async function sourceProductImages(product: ProductWithImageContext, query: string) {
  const before = new Set<string>();
  const candidates: ImageCandidateInput[] = [];
  async function collect(sourceName: string, provider: () => Promise<ImageCandidateInput[]>) {
    try {
      const rows = await provider();
      for (const row of rows) {
        if (before.has(row.imageUrlOriginal)) continue;
        before.add(row.imageUrlOriginal);
        candidates.push(row);
      }
      await logImageAttempt({ productId: product.id, query, sourceName, result: rows.length ? "candidates" : "empty" });
    } catch (error) {
      await logImageAttempt({ productId: product.id, query, sourceName, result: "provider_error", error: error instanceof Error ? error.message : "Error proveedor" });
    }
  }
  await collect("configured_endpoint", () => searchEndpoint(product, query));
  await collect("bing_api", () => searchBing(product, query));
  await collect("bing_html", () => searchBingHtml(product, query));
  await collect("duckduckgo", () => searchDuckDuckGo(product, query));
  return candidates;
}

export async function ensureImageJobs() {
  const products = await prisma.product.findMany({ where: { activo: true }, select: { id: true, imagenPrincipal: true } });
  let created = 0;
  for (const product of products) {
    if (!(await productNeedsImage(product))) continue;
    const existing = await prisma.productImageJob.findUnique({ where: { productId: product.id } });
    if (!existing) {
      await prisma.productImageJob.create({ data: { productId: product.id, status: "pending" } });
      created += 1;
    }
  }
  return created;
}

function nextRetryDate(attempts: number) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + Math.min(1440, Math.max(5, attempts * 15)));
  return date;
}

async function processProductImageJob(job: ProductImageJob) {
  const product = await prisma.product.findUnique({ where: { id: job.productId }, include: { brand: true, category: true } });
  if (!product) throw new Error("Producto no existe");
  if (!(await productNeedsImage(product))) {
    await prisma.productImageJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), lastError: null } });
    return { codigoInterno: product.codigoInterno, ok: true, skipped: true, status: "completed" };
  }
  await prisma.productImageJob.update({ where: { id: job.id }, data: { status: "processing", lastRunAt: new Date(), attempts: { increment: 1 } } });
  let lastError = "Sin candidato encontrado";
  for (const query of queriesForProduct(product)) {
    const candidates = (await sourceProductImages(product, query)).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    for (const candidate of candidates) {
      try {
        const saved = await saveCandidate(product, candidate);
        await logImageAttempt({
          productId: product.id,
          query,
          sourceName: candidate.sourceName,
          imageUrlOriginal: candidate.imageUrlOriginal,
          sourceUrl: candidate.sourceUrl,
          result: saved.status,
          confidence: saved.confidence,
          localPath: saved.localPath,
          contentHash: saved.contentHash,
        });
        await prisma.productImageJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), lastError: null, nextRunAt: null } });
        return { codigoInterno: product.codigoInterno, ok: true, localPath: saved.localPath ?? undefined, status: saved.status };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Error al descargar candidato";
        await logImageAttempt({
          productId: product.id,
          query,
          sourceName: candidate.sourceName,
          imageUrlOriginal: candidate.imageUrlOriginal,
          sourceUrl: candidate.sourceUrl,
          result: "download_error",
          error: lastError,
          confidence: candidate.confidence,
        });
      }
    }
  }
  const freshJob = await prisma.productImageJob.findUnique({ where: { id: job.id } });
  const attempts = (freshJob?.attempts ?? job.attempts + 1);
  await prisma.productImageJob.update({ where: { id: job.id }, data: { status: "pending", lastError, nextRunAt: nextRetryDate(attempts) } });
  return { codigoInterno: product.codigoInterno, ok: false, error: lastError };
}

export async function imageStatus() {
  const products = await prisma.product.findMany({ select: { id: true, imagenPrincipal: true } });
  let withImage = 0;
  let missing = 0;
  let broken = 0;
  for (const product of products) {
    if (await productNeedsImage(product)) {
      missing += 1;
      if (product.imagenPrincipal?.startsWith("/uploads/")) broken += 1;
    } else {
      withImage += 1;
    }
  }
  const [jobs, candidates, logs, assetsWithHash, suspiciousCount, rejectedCount] = await Promise.all([
    prisma.productImageJob.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
    prisma.productImageCandidate.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
    prisma.productImageLog.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.mediaAsset.findMany({ where: { checksum: { not: null } }, select: { checksum: true } }).catch(() => []),
    prisma.productImageQualityIssue.count({ where: { status: "suspected" } }).catch(() => 0),
    prisma.productImageCandidate.count({ where: { status: "rejected" } }).catch(() => 0),
  ]);
  const hashCounts = new Map<string, number>();
  for (const asset of assetsWithHash) if (asset.checksum) hashCounts.set(asset.checksum, (hashCounts.get(asset.checksum) ?? 0) + 1);
  const duplicated = Array.from(hashCounts.values()).filter((count) => count > 1).length;
  return {
    total: products.length,
    withImage,
    missing,
    broken,
    percent: products.length ? Math.round((withImage / products.length) * 100) : 0,
    jobs: Object.fromEntries(jobs.map((item) => [item.status, item._count._all])),
    candidates: Object.fromEntries(candidates.map((item) => [item.status, item._count._all])),
    duplicates: duplicated,
    suspicious: suspiciousCount,
    rejected: rejectedCount,
    lastLog: logs,
  };
}

export async function qualityAuditImages() {
  const products = await prisma.product.findMany({ where: { imagenPrincipal: { not: null } }, include: { brand: true, category: true, imageCandidates: { orderBy: { createdAt: "desc" }, take: 3 } } });
  const issues: Array<{ codigoInterno: string; nombre: string; imagenPrincipal: string | null; reason: string; severity: string }> = [];
  for (const product of products) {
    if (!product.imagenPrincipal || !(await localImageExists(product.imagenPrincipal))) continue;
    const candidate = product.imageCandidates.find((item) => item.localPath === product.imagenPrincipal) ?? product.imageCandidates[0];
    const assessment = imageQualityAssessment(product, {
      imageUrlOriginal: candidate?.imageUrlOriginal ?? product.imagenPrincipal,
      sourceUrl: candidate?.sourceUrl ?? product.imagenPrincipal,
      sourceName: candidate?.sourceName ?? "Imagen actual",
      confidence: candidate?.confidence ?? 0,
    });
    const reason = !assessment.ok ? assessment.reason : assessment.relevance < 82 ? `Relevancia baja (${assessment.relevance})` : "";
    if (reason) {
      const severity = reason.includes("persona") || reason.includes("turistico") || reason.includes("deportivo") || reason.includes("muebles") ? "high" : "medium";
      await prisma.productImageQualityIssue.upsert({
        where: { id: `${product.id}:${product.imagenPrincipal}` },
        create: { id: `${product.id}:${product.imagenPrincipal}`, productId: product.id, localPath: product.imagenPrincipal, reason, severity, status: "suspected" },
        update: { reason, severity, status: "suspected" },
      }).catch(async () => {
        await prisma.productImageQualityIssue.create({ data: { productId: product.id, localPath: product.imagenPrincipal, reason, severity, status: "suspected" } });
      });
      issues.push({ codigoInterno: product.codigoInterno, nombre: product.nombre, imagenPrincipal: product.imagenPrincipal, reason, severity });
    }
  }
  return { totalWithImage: products.length, suspicious: issues.length, issues };
}

export async function qualityFixImages() {
  const audit = await qualityAuditImages();
  const issues = await prisma.productImageQualityIssue.findMany({ where: { status: "suspected" }, include: { product: true } });
  let fixed = 0;
  for (const issue of issues) {
    await prisma.product.update({ where: { id: issue.productId }, data: { imagenPrincipal: null, imagenes: "[]" } });
    if (issue.localPath) {
      await prisma.productImageCandidate.updateMany({ where: { productId: issue.productId, localPath: issue.localPath }, data: { status: "rejected", error: issue.reason } });
    }
    await prisma.productImageJob.upsert({
      where: { productId: issue.productId },
      create: { productId: issue.productId, status: "pending", priority: 30, nextRunAt: new Date(), lastError: issue.reason },
      update: { status: "pending", priority: 30, nextRunAt: new Date(), lastError: issue.reason },
    });
    await prisma.productImageQualityIssue.update({ where: { id: issue.id }, data: { status: "rejected", reviewedAt: new Date() } });
    fixed += 1;
  }
  return { ...audit, fixed };
}

export async function processImageQueue(options: ImageProcessOptions = {}) {
  const startedAt = Date.now();
  await ensureImageJobs();
  const limit = options.all ? 10000 : Math.max(1, Math.min(500, Number(options.limit ?? 50)));
  const now = new Date();
  const jobs = await prisma.productImageJob.findMany({
    where: {
      OR: [
        { status: "pending", OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
        ...(options.retryErrors ? [{ status: "error" }] : []),
      ],
    },
    orderBy: [{ priority: "desc" }, { attempts: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });
  const results: ImageImportResult[] = [];
  for (const job of jobs) results.push(await processProductImageJob(job));
  const populated = results.filter((item) => item.ok && item.localPath).length;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const status = await imageStatus();
  return {
    scanned: jobs.length,
    populated,
    results,
    status,
    progress: {
      done: status.withImage,
      total: status.total,
      percent: status.percent,
      elapsedSeconds,
      speedPerMinute: Math.round((jobs.length / elapsedSeconds) * 60),
      etaMinutes: jobs.length ? Math.ceil((status.missing / Math.max(1, jobs.length / elapsedSeconds)) / 60) : null,
    },
  };
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
  return processImageQueue({ limit });
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
  const [pending, missingProducts, stats, status, logs, suspicious] = await Promise.all([
    prisma.productImageCandidate.findMany({ where: { status: "pending" }, include: { product: { include: { brand: true, category: true } } }, orderBy: [{ confidence: "desc" }, { createdAt: "desc" }], take: 100 }),
    productsNeedingImages(100),
    prisma.productImageCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    imageStatus(),
    prisma.productImageLog.findMany({ include: { product: { select: { codigoInterno: true, nombre: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.productImageQualityIssue.findMany({ where: { status: "suspected" }, include: { product: { include: { brand: true, category: true } } }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }], take: 100 }),
  ]);
  return {
    pending,
    missingProducts,
    stats: Object.fromEntries(stats.map((item) => [item.status, item._count._all])),
    status,
    logs,
    suspicious,
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
  const job = await prisma.productImageJob.upsert({
    where: { productId },
    create: { productId, status: "pending", nextRunAt: new Date(), priority: 10 },
    update: { status: "pending", nextRunAt: new Date(), priority: 10, lastError: null },
  });
  return processProductImageJob(job);
}

export type ProductImageCandidateWithProduct = Prisma.ProductImageCandidateGetPayload<{
  include: { product: { include: { brand: true; category: true } } };
}>;
