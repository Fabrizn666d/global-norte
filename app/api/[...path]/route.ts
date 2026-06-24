import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/company";
import { clearSessionCookie, sessionFromRequest, setSessionCookie } from "@/lib/auth";
import { verifyCaptcha } from "@/lib/captcha";
import { ORDER_STATES } from "@/lib/constants";
import { makeSlug, toCsv } from "@/lib/format";
import { createAdminOrderPdf, createOrderPdf } from "@/lib/pdf";
import { checkRateLimit } from "@/lib/rate-limit";
import { nextOrderNumber } from "@/lib/orders";
import { evaluateCommerce } from "@/lib/commerce";
import { ConsolidatedRow, createConsolidatedPdf } from "@/lib/consolidated-pdf";
import { sendOrderEmails, sendOrderWhatsApp } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: { path?: string[] } };
type Data = Record<string, unknown>;

const registerSchema = z.object({
  nombre: z.string().optional(),
  apellido: z.string().optional(),
  contacto: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(6),
  telefono: z.string().min(7),
  dni: z.string().optional(),
  ruc: z.string().optional(),
  nombreNegocio: z.string().min(2),
  tipoNegocio: z.string().optional(),
  departamento: z.string().optional(),
  provincia: z.string().optional(),
  distrito: z.string().optional(),
  direccion: z.string().min(5),
  referencia: z.string().optional(),
  captchaToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

const checkoutSchema = z.object({
  captchaToken: z.string().optional(),
  metodoPago: z.enum(["efectivo", "transferencia", "yape", "plin"]).default("efectivo"),
  metodoEntrega: z.string().optional(),
  nombreNegocio: z.string().optional(),
  contacto: z.string().optional(),
  nombre: z.string().optional(),
  apellido: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  telefono: z.string().optional(),
  dni: z.string().optional(),
  ruc: z.string().optional(),
  direccion: z.string().min(5),
  distrito: z.string().optional(),
  provincia: z.string().default("Lima"),
  departamento: z.string().default("Lima"),
  referencia: z.string().optional(),
  mapsUrl: z.string().url().optional().or(z.literal("")),
  couponCode: z.string().optional(),
  notas: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    cantidad: z.coerce.number().int().positive(),
    tipoPrecio: z.enum(["unidad", "caja"]).default("unidad"),
  })).optional(),
});

const productSchema = z.object({
  codigoInterno: z.string().min(2),
  nombre: z.string().min(2),
  descripcion: z.string().optional(),
  categoryId: z.string().min(1),
  brandId: z.string().optional().nullable(),
  precioUnitario: z.coerce.number().nonnegative(),
  precioCaja: z.coerce.number().nonnegative().optional().nullable(),
  unidadesPorCaja: z.coerce.number().int().positive().optional().nullable(),
  etiquetaCaja: z.string().optional().nullable(),
  precioAnterior: z.coerce.number().nonnegative().optional().nullable(),
  stock: z.coerce.number().int().default(0),
  stockMinimo: z.coerce.number().int().default(1),
  unidad: z.string().default("unidad"),
  imagenPrincipal: z.string().optional().nullable(),
  activo: z.boolean().default(true),
  destacado: z.boolean().default(false),
  mostrarEnHome: z.boolean().default(false),
  ordenDestacado: z.coerce.number().int().default(0),
  etiquetaDestacada: z.string().optional().nullable(),
  enOferta: z.boolean().default(false),
  nuevo: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  seoTitulo: z.string().optional().nullable(),
  seoDesc: z.string().optional().nullable(),
});

function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function fail(message: string, status = 400, extra: Data = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

async function readJson(request: NextRequest) {
  try {
    return (await request.json()) as Data;
  } catch {
    return {};
  }
}

function getIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dateOrNull(value: unknown) {
  const text = asString(value).trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonList(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(asStringArray(value));
  const text = asString(value).trim();
  if (!text) return "[]";
  return JSON.stringify(text.split(",").map((item) => item.trim()).filter(Boolean));
}

const customerSelect = {
  password: false,
  id: true,
  nombre: true,
  apellido: true,
  email: true,
  telefono: true,
  dni: true,
  ruc: true,
  nombreNegocio: true,
  tipoNegocio: true,
  departamento: true,
  provincia: true,
  distrito: true,
  direccion: true,
  referencia: true,
  rol: true,
  activo: true,
  bloqueado: true,
} satisfies Prisma.UserSelect;

function splitContact(contact?: string | null) {
  const parts = (contact ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    nombre: parts[0] || "Cliente",
    apellido: parts.slice(1).join(" ") || "-",
  };
}

function normalizeCustomerEmail(email: string | undefined, telefono: string) {
  return email?.trim() || `${telefono.replace(/\D/g, "")}@clientes.globalnorte.local`;
}

function customerAuthSegments(segments: string[]) {
  const [first, second, ...rest] = segments;
  if (first !== "customer" && first !== "clientes") return null;
  if (second === "orders" || second === "pedidos") return ["mis-pedidos", ...rest];
  if (second === "me") return ["auth", "me"];
  if (["login", "register", "registro", "logout"].includes(second ?? "")) {
    return ["auth", second === "register" ? "registro" : second ?? "", ...rest];
  }
  return null;
}

function normalizeSegments(segments: string[]) {
  const aliases: Record<string, string> = {
    products: "productos",
    product: "productos",
    catalogo: "productos",
    categories: "categorias",
    category: "categorias",
    brands: "marcas",
    brand: "marcas",
    orders: "pedidos",
    order: "pedidos",
  };
  const [first, ...rest] = segments;
  return first ? [aliases[first] ?? first, ...rest] : segments;
}

async function requireCustomer(request: NextRequest) {
  const session = await sessionFromRequest(request, "customer");
  return session?.kind === "customer" ? session : null;
}

async function requireAdmin(request: NextRequest) {
  const session = await sessionFromRequest(request, "admin");
  return session?.kind === "admin" ? session : null;
}

async function getSettingsMap() {
  const settings = await prisma.setting.findMany();
  return new Map(settings.map((setting) => [setting.clave, setting.valor]));
}

async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findFirst({
    where: { userId },
    include: { items: { include: { product: { include: { category: true, brand: true } } }, orderBy: { createdAt: "desc" } } },
  });
  if (existing) return existing;
  return prisma.cart.create({
    data: { userId },
    include: { items: { include: { product: { include: { category: true, brand: true } } } } },
  });
}

async function commerceLines(items: Array<{ productId: string; cantidad: number; tipoPrecio?: string }>) {
  const products = await prisma.product.findMany({
    where: { id: { in: items.map((item) => item.productId) }, activo: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return items.flatMap((item) => {
    const product = byId.get(item.productId);
    if (!product) return [];
    const quantity = Math.max(1, Number(item.cantidad || 1));
    const price = item.tipoPrecio === "caja" && product.precioCaja ? product.precioCaja : product.precioUnitario;
    return [{ productId: product.id, categoryId: product.categoryId, brandId: product.brandId, cantidad: quantity, subtotal: price * quantity }];
  });
}

function productWhere(search: URLSearchParams, includeInactive = false): Prisma.ProductWhereInput {
  const q = (search.get("q") ?? search.get("search"))?.trim();
  const categoria = (search.get("categoria") ?? search.get("category"))?.trim();
  const marca = (search.get("marca") ?? search.get("brand"))?.trim();
  const precioMinParam = search.get("precioMin") ?? search.get("minPrice");
  const precioMaxParam = search.get("precioMax") ?? search.get("maxPrice");
  const precioMin = precioMinParam ? Number(precioMinParam) : Number.NaN;
  const precioMax = precioMaxParam ? Number(precioMaxParam) : Number.NaN;
  const where: Prisma.ProductWhereInput = includeInactive ? {} : { activo: true };

  if (q) {
    where.OR = [
      { nombre: { contains: q } },
      { codigoInterno: { contains: q } },
      { tags: { contains: q.toLowerCase() } },
      { brand: { nombre: { contains: q } } },
    ];
  }
  if (categoria) where.category = { slug: categoria };
  if (marca) where.brand = { slug: marca };
  if (search.get("disponible") === "1") where.stock = { gt: 0 };
  if (search.get("oferta") === "1") where.enOferta = true;
  if (search.get("destacado") === "1") where.destacado = true;
  if (search.get("home") === "1") {
    delete where.destacado;
    where.AND = [{ OR: [{ mostrarEnHome: true }, { destacado: true }] }];
  }
  if (search.get("nuevo") === "1") where.nuevo = true;
  if (!Number.isNaN(precioMin) || !Number.isNaN(precioMax)) {
    where.precioUnitario = {
      ...(Number.isNaN(precioMin) ? {} : { gte: precioMin }),
      ...(Number.isNaN(precioMax) ? {} : { lte: precioMax }),
    };
  }
  return where;
}

async function listProducts(request: NextRequest, includeInactive = false) {
  const search = request.nextUrl.searchParams;
  const page = Math.max(1, Number(search.get("pagina") ?? search.get("page") ?? "1"));
  const limit = Math.min(500, Math.max(1, Number(search.get("limite") ?? "24")));
  const where = productWhere(search, includeInactive);
  const sort = search.get("sort") ?? search.get("orden") ?? "nombre";
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = search.get("home") === "1"
    ? [{ ordenDestacado: "asc" }, { vendidos: "desc" }, { createdAt: "desc" }]
    :
    sort === "precio_asc" || sort === "price_asc"
      ? [{ precioUnitario: "asc" }]
      : sort === "precio_desc" || sort === "price_desc"
        ? [{ precioUnitario: "desc" }]
        : sort === "recientes" || sort === "newest"
          ? [{ createdAt: "desc" }]
          : [{ destacado: "desc" }, { nombre: "asc" }];
  let [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { category: true, brand: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  if (search.get("home") === "1" && products.length < limit) {
    const fallback = await prisma.product.findMany({
      where: { activo: true, id: { notIn: products.map((product) => product.id) } },
      include: { category: true, brand: true },
      orderBy: [{ vendidos: "desc" }, { createdAt: "desc" }],
      take: limit - products.length,
    });
    products = [...products, ...fallback];
    total = products.length;
  }
  return ok({ success: true, data: { products }, products, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}

async function publicGet(request: NextRequest, segments: string[]) {
  segments = customerAuthSegments(segments) ?? segments;
  segments = normalizeSegments(segments);
  const [first, second, third] = segments;

  if (first === "media" && second === "uploads") {
    const relativeParts = segments.slice(2).filter((part) => part && part !== "." && part !== "..");
    if (!relativeParts.length) return fail("Archivo no encontrado", 404);
    const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
    const filePath = path.resolve(uploadRoot, ...relativeParts);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) return fail("Ruta no permitida", 403);
    const file = await fs.readFile(filePath).catch(() => null);
    if (!file) return fail("Archivo no encontrado", 404);
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentTypes[extension] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=300, must-revalidate",
      },
    });
  }

  if (first === "productos" && !second) return listProducts(request);
  if (first === "productos" && second) {
    const product = await prisma.product.findUnique({
      where: { slug: second },
      include: { category: true, brand: true },
    });
    if (!product || !product.activo) return fail("Producto no encontrado", 404);
    const related = await prisma.product.findMany({
      where: { activo: true, categoryId: product.categoryId, id: { not: product.id } },
      include: { category: true, brand: true },
      take: 8,
    });
    return ok({ product, related });
  }

  if (first === "categorias") {
    const categories = await prisma.category.findMany({
      where: { activo: true },
      include: { _count: { select: { products: true } }, hijos: true },
      orderBy: { orden: "asc" },
    });
    return ok({ categories });
  }

  if (first === "marcas") {
    const brands = await prisma.brand.findMany({
      where: { activo: true },
      include: { _count: { select: { products: true } } },
      orderBy: [{ destacada: "desc" }, { orden: "asc" }, { nombre: "asc" }],
    });
    return ok({ brands });
  }

  if (first === "banners") {
    const posicion = request.nextUrl.searchParams.get("posicion") ?? undefined;
    const now = new Date();
    const banners = await prisma.banner.findMany({
      where: {
        activo: true,
        ...(posicion ? { posicion } : {}),
        OR: [{ fechaInicio: null }, { fechaInicio: { lte: now } }],
        AND: [{ OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] }],
      },
      orderBy: [{ orden: "asc" }, { createdAt: "desc" }],
    });
    return ok({ banners });
  }

  if (first === "notificaciones") {
    const session = await requireCustomer(request);
    const now = new Date();
    const notifications = await prisma.notification.findMany({
      where: {
        activo: true,
        OR: [
          { publico: "todos" },
          ...(session ? [{ publico: "registrados" }, { publico: "cliente", clienteId: session.id }] : []),
        ],
        AND: [
          { OR: [{ fechaInicio: null }, { fechaInicio: { lte: now } }] },
          { OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const user = session ? await prisma.user.findUnique({ where: { id: session.id }, select: { nombre: true } }) : null;
    return ok({ notifications: notifications.map((item) => ({ ...item, mensaje: item.mensaje.replace(/\{nombre\}/g, user?.nombre || "cliente") })) });
  }

  if (first === "configuracion-publica") {
    const settings = await getSettingsMap();
    return ok({
      company: {
        name: settings.get("nombre_empresa") ?? COMPANY.name,
        ruc: settings.get("ruc") ?? COMPANY.ruc,
        whatsappDisplay: settings.get("telefono") ?? COMPANY.whatsappDisplay,
        whatsappNumber: settings.get("whatsapp") ?? COMPANY.whatsappNumber,
        email: settings.get("email") ?? COMPANY.email,
        address: settings.get("direccion") ?? COMPANY.address,
      },
    });
  }

  if (first === "busqueda") {
    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const products = q
      ? await prisma.product.findMany({
          where: productWhere(new URLSearchParams({ q }), false),
          include: { category: true, brand: true },
          take: third === "sugerencias" || second === "sugerencias" ? 8 : 24,
        })
      : [];
    return ok({ products, suggestions: products.map((product) => product.nombre) });
  }

  if (first === "auth" && second === "me") {
    const session = await requireCustomer(request);
    if (!session) return ok({ user: null });
    const user = await prisma.user.findUnique({ where: { id: session.id }, select: customerSelect });
    return ok({ user });
  }

  if (first === "carrito") {
    const session = await requireCustomer(request);
    if (!session) return fail("Inicia sesion para ver tu carrito", 401);
    const cart = await getOrCreateCart(session.id);
    return ok({ cart });
  }

  if (first === "mis-pedidos") {
    const session = await requireCustomer(request);
    if (!session) return fail("No autorizado", 401);
    const orders = await prisma.order.findMany({
      where: { userId: session.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    return ok({ orders });
  }

  if (first === "pedidos" && second) {
    const session = await requireCustomer(request);
    if (!session) return fail("No autorizado", 401);
    const order = await prisma.order.findFirst({
      where: { id: second, userId: session.id },
      include: { items: true, historial: { orderBy: { createdAt: "asc" } } },
    });
    if (!order) return fail("Pedido no encontrado", 404);
    return ok({ order });
  }

  if (first === "pdf" && second) {
    const session = await requireCustomer(request);
    const admin = await requireAdmin(request);
    if (!session && !admin) return fail("No autorizado", 401);
    const order = await prisma.order.findFirst({
      where: { id: second, ...(session ? { userId: session.id } : {}) },
    });
    if (!order?.pdfUrl) return fail("PDF no encontrado", 404);
    const filePath = path.join(process.cwd(), "public", order.pdfUrl.replace(/^\//, ""));
    const file = await fs.readFile(filePath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${order.numero}.pdf"`,
      },
    });
  }

  if (first === "cuenta") return accountGet(request, segments);
  if (first === "admin") return adminGet(request, segments.slice(1));

  return fail("Ruta no encontrada", 404);
}

async function publicPost(request: NextRequest, segments: string[]) {
  segments = customerAuthSegments(segments) ?? segments;
  segments = normalizeSegments(segments);
  const [first, second, third] = segments;
  const ip = getIp(request);

  if (first === "productos" && third === "vista") {
    await prisma.product.update({ where: { slug: second }, data: { vistas: { increment: 1 } } }).catch(() => null);
    return ok({ ok: true });
  }

  if (first === "auth" && second === "registro") {
    const limited = await checkRateLimit(ip, "registro", 3, 60 * 60 * 1000);
    if (!limited.ok) return fail("Demasiados registros desde esta IP", 429);
    const data = registerSchema.parse(await readJson(request));
    if (data.captchaToken && !(await verifyCaptcha(data.captchaToken))) return fail("Captcha invalido", 400);
    const telefono = data.telefono.replace(/\s+/g, "").trim();
    const email = normalizeCustomerEmail(data.email, telefono);
    const exists = await prisma.user.findFirst({
      where: { OR: [{ telefono }, { email }] },
    });
    if (exists?.telefono === telefono) return fail("El telefono ya esta registrado", 409);
    if (data.email && exists?.email === email) return fail("El email ya esta registrado", 409);
    const contact = splitContact(data.contacto || [data.nombre, data.apellido].filter(Boolean).join(" "));

    const user = await prisma.user.create({
      data: {
        nombre: data.nombre || contact.nombre,
        apellido: data.apellido || contact.apellido,
        email,
        telefono,
        dni: data.dni,
        ruc: data.ruc,
        nombreNegocio: data.nombreNegocio,
        tipoNegocio: data.tipoNegocio,
        departamento: data.departamento || "Lima",
        provincia: data.provincia || "Lima",
        distrito: data.distrito,
        direccion: data.direccion,
        referencia: data.referencia,
        password: await bcrypt.hash(data.password, 12),
      },
    });
    const response = ok({ user: { ...user, password: undefined } });
    await setSessionCookie(response, { id: user.id, email: user.email, role: user.rol, kind: "customer" });
    return response;
  }

  if (first === "auth" && second === "login") {
    const limited = await checkRateLimit(ip, "login", 5, 15 * 60 * 1000);
    if (!limited.ok) return fail("Login bloqueado temporalmente", 429);
    const data = loginSchema.parse(await readJson(request));
    const credential = data.email.trim();
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: credential }, { telefono: credential.replace(/\s+/g, "") }] },
    });
    if (!user || user.bloqueado || !(await bcrypt.compare(data.password, user.password))) {
      return fail("Credenciales invalidas", 401);
    }
    await prisma.user.update({ where: { id: user.id }, data: { ultimoAcceso: new Date() } });
    const response = ok({ user: { ...user, password: undefined } });
    await setSessionCookie(response, { id: user.id, email: user.email, role: user.rol, kind: "customer" });
    return response;
  }

  if (first === "auth" && second === "logout") {
    const response = ok({ ok: true });
    clearSessionCookie(response, "customer");
    return response;
  }

  if (first === "carrito" && second === "items") {
    const session = await requireCustomer(request);
    if (!session) return fail("Inicia sesion para agregar productos", 401);
    const body = await readJson(request);
    const productId = asString(body.productId);
    const cantidad = Math.max(1, Number(body.cantidad ?? 1));
    const tipoPrecio = asString(body.tipoPrecio, "unidad") === "caja" ? "caja" : "unidad";
    const product = await prisma.product.findFirst({ where: { id: productId, activo: true } });
    if (!product) return fail("Producto no disponible", 404);
    const cart = await getOrCreateCart(session.id);
    const item = await prisma.cartItem.upsert({
      where: { cartId_productId_tipoPrecio: { cartId: cart.id, productId, tipoPrecio } },
      update: { cantidad: { increment: cantidad } },
      create: { cartId: cart.id, productId, cantidad, tipoPrecio },
    });
    return ok({ item });
  }

  if (first === "cupones" && second === "validar") {
    const session = await requireCustomer(request);
    if (!session) return fail("Inicia sesion para aplicar beneficios", 401);
    const body = await readJson(request);
    const items = Array.isArray(body.items) ? body.items as Array<{ productId: string; cantidad: number; tipoPrecio?: string }> : [];
    if (!items.length) return fail("El carrito esta vacio", 400);
    const result = await evaluateCommerce({
      userId: session.id,
      couponCode: asString(body.couponCode),
      lines: await commerceLines(items),
    });
    return ok({ benefit: result });
  }

  if (first === "checkout") return checkout(request);
  if (first === "pedidos") return checkout(request);

  if (first === "cuenta") return accountPost(request, segments);
  if (first === "admin") return adminPost(request, segments.slice(1));
  if (first === "upload") return uploadFile(request);

  return fail("Ruta no encontrada", 404);
}

async function publicPut(request: NextRequest, segments: string[]) {
  segments = normalizeSegments(segments);
  const [first, second, third] = segments;

  if (first === "carrito" && second === "items" && third) {
    const session = await requireCustomer(request);
    if (!session) return fail("No autorizado", 401);
    const body = await readJson(request);
    const cantidad = Math.max(1, Number(body.cantidad ?? 1));
    const item = await prisma.cartItem.update({
      where: { id: third },
      data: { cantidad },
    });
    return ok({ item });
  }

  if (first === "cuenta") return accountPut(request, segments);
  if (first === "admin") return adminPut(request, segments.slice(1));

  return fail("Ruta no encontrada", 404);
}

async function publicDelete(request: NextRequest, segments: string[]) {
  segments = normalizeSegments(segments);
  const [first, second, third] = segments;

  if (first === "carrito" && !second) {
    const session = await requireCustomer(request);
    if (!session) return fail("No autorizado", 401);
    const cart = await getOrCreateCart(session.id);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return ok({ ok: true });
  }

  if (first === "carrito" && second === "items" && third) {
    const session = await requireCustomer(request);
    if (!session) return fail("No autorizado", 401);
    await prisma.cartItem.delete({ where: { id: third } });
    return ok({ ok: true });
  }

  if (first === "cuenta") return accountDelete(request, segments);
  if (first === "admin") return adminDelete(request, segments.slice(1));

  return fail("Ruta no encontrada", 404);
}

async function checkout(request: NextRequest) {
  const session = await requireCustomer(request);
  if (!session) return fail("Inicia sesion o registrate para finalizar el pedido", 401);
  const limited = await checkRateLimit(getIp(request), "checkout", 5, 60 * 60 * 1000);
  if (!limited.ok) return fail("Demasiados pedidos desde esta IP", 429);

  const data = checkoutSchema.parse(await readJson(request));
  if (data.captchaToken && !(await verifyCaptcha(data.captchaToken))) return fail("Captcha invalido", 400);

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || user.bloqueado) return fail("Cuenta no disponible", 403);

  const serverCart = await getOrCreateCart(session.id);
  const requestedItems = data.items?.length
    ? data.items
    : serverCart.items.map((item) => ({ productId: item.productId, cantidad: item.cantidad, tipoPrecio: item.tipoPrecio }));
  if (!requestedItems.length) return fail("El carrito esta vacio", 400);

  const products = await prisma.product.findMany({
    where: { id: { in: requestedItems.map((item) => item.productId) }, activo: true },
    include: { brand: true },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));
  const orderItems = requestedItems
    .map((item) => {
      const product = productMap.get(item.productId);
      if (!product) return null;
      const tipoPrecio = item.tipoPrecio === "caja" && product.precioCaja ? "caja" : "unidad";
      const price = tipoPrecio === "caja" && product.precioCaja ? product.precioCaja : product.precioUnitario;
      return {
        product,
        tipoPrecio,
        cantidad: Math.max(1, item.cantidad),
        precio: price,
        subtotal: price * Math.max(1, item.cantidad),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!orderItems.length) return fail("No hay productos disponibles en el pedido", 400);

  const subtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
  const commerce = await evaluateCommerce({
    userId: user.id,
    couponCode: data.couponCode,
    lines: orderItems.map((item) => ({
      productId: item.product.id,
      categoryId: item.product.categoryId,
      brandId: item.product.brandId,
      cantidad: item.cantidad,
      subtotal: item.subtotal,
    })),
  });
  const numero = await nextOrderNumber();
  const contacto = data.contacto || data.nombre || user?.nombre || "Cliente";
  const partes = contacto.trim().split(/\s+/);
  const clienteNombre = user?.nombre ?? partes[0] ?? "Cliente";
  const clienteApellido = user?.apellido ?? (partes.slice(1).join(" ") || "-");
  const telefono = data.telefono || user?.telefono || "Sin telefono";

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        numero,
        userId: user?.id,
        clienteNombre,
        clienteApellido,
        clienteEmail: (data.email || user?.email || `pedido-${numero.toLowerCase()}@globalnorte.local`) as string,
        clienteTelefono: telefono,
        clienteDni: data.dni || user?.dni,
        clienteRuc: data.ruc || user?.ruc,
        clienteNegocio: data.nombreNegocio || user?.nombreNegocio,
        entregaDireccion: data.direccion,
        entregaDistrito: data.distrito || "Por coordinar",
        entregaProvincia: data.provincia,
        entregaDepartamento: data.departamento,
        entregaReferencia: [data.metodoEntrega ? `Entrega: ${data.metodoEntrega}` : "", data.referencia ?? ""].filter(Boolean).join(" | ") || null,
        entregaMapsUrl: data.mapsUrl || null,
        metodoEntrega: data.metodoEntrega || "coordinada",
        estado: "nuevo",
        metodoPago: data.metodoPago,
        subtotal,
        descuento: commerce.discount,
        cuponCodigo: commerce.coupon?.code,
        cuponDescripcion: commerce.coupon?.description,
        bonificaciones: JSON.stringify(commerce.bonuses),
        total: commerce.total,
        notasCliente: data.notas,
        items: {
          create: orderItems.map((item) => ({
            productId: item.product.id,
            codigoInterno: item.product.codigoInterno,
            nombre: item.product.nombre,
            marca: item.product.brand?.nombre,
            imagen: item.product.imagenPrincipal,
            tipoPrecio: item.tipoPrecio,
            etiqueta: item.product.etiquetaCaja,
            precio: item.precio,
            cantidad: item.cantidad,
            subtotal: item.subtotal,
          })),
        },
        historial: { create: { estado: "nuevo", nota: "Pedido registrado para coordinacion." } },
      },
      include: { items: true, historial: true },
    });

    for (const item of orderItems) {
      await tx.product.update({ where: { id: item.product.id }, data: { vendidos: { increment: item.cantidad } } });
    }
    if (commerce.coupon) {
      await tx.couponUsage.create({ data: { couponId: commerce.coupon.id, userId: user.id, orderId: created.id } });
      await tx.coupon.update({ where: { id: commerce.coupon.id }, data: { cantidadUsos: { increment: 1 } } });
    }
    if (serverCart) await tx.cartItem.deleteMany({ where: { cartId: serverCart.id } });
    return created;
  });

  const settings = await getSettingsMap();
  const pdfUrl = await createOrderPdf(order);
  const notificationOrder = {
    numero: order.numero,
    clienteNombre: order.clienteNombre,
    clienteApellido: order.clienteApellido,
    clienteEmail: order.clienteEmail,
    clienteTelefono: order.clienteTelefono,
    entregaDireccion: order.entregaDireccion,
    metodoPago: order.metodoPago,
    total: order.total,
    items: order.items.map((item) => ({ nombre: item.nombre, cantidad: item.cantidad, subtotal: item.subtotal })),
  };
  const emails = await sendOrderEmails(notificationOrder).catch(() => ({ sent: false, savedToOutbox: false }));
  const whatsApp = await sendOrderWhatsApp(
    notificationOrder,
    process.env.ADMIN_WHATSAPP ?? settings.get("whatsapp") ?? COMPANY.whatsappNumber,
    settings.get("mensaje_whatsapp_pedido") ?? undefined,
  ).catch(() => {
    return { sent: false, link: `https://wa.me/${process.env.ADMIN_WHATSAPP ?? settings.get("whatsapp") ?? COMPANY.whatsappNumber}` };
  });

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { pdfUrl, emailEnviado: emails.sent || emails.savedToOutbox, whatsappEnviado: whatsApp.sent },
    include: { items: true },
  });

  return ok({ success: true, data: { order: updated, waLink: whatsApp.link }, order: updated, waLink: whatsApp.link });
}

async function accountGet(request: NextRequest, segments: string[]) {
  const session = await requireCustomer(request);
  if (!session) return fail("No autorizado", 401);
  const [, second] = segments;
  if (second === "perfil" || !second) {
    const user = await prisma.user.findUnique({ where: { id: session.id }, select: { password: false, id: true, nombre: true, apellido: true, email: true, telefono: true, dni: true, ruc: true, nombreNegocio: true, tipoNegocio: true, departamento: true, provincia: true, distrito: true, direccion: true, referencia: true, rol: true, activo: true, bloqueado: true } });
    return ok({ user });
  }
  if (second === "direcciones") {
    const addresses = await prisma.address.findMany({ where: { userId: session.id }, orderBy: [{ esPrincipal: "desc" }, { createdAt: "desc" }] });
    return ok({ addresses });
  }
  return fail("Ruta no encontrada", 404);
}

async function accountPost(request: NextRequest, segments: string[]) {
  const session = await requireCustomer(request);
  if (!session) return fail("No autorizado", 401);
  const [, second] = segments;
  if (second === "direcciones") {
    const body = await readJson(request);
    const address = await prisma.address.create({
      data: {
        userId: session.id,
        alias: asString(body.alias, "Negocio"),
        nombres: asString(body.nombres),
        telefono: asString(body.telefono),
        departamento: asString(body.departamento, "Lima"),
        provincia: asString(body.provincia, "Lima"),
        distrito: asString(body.distrito),
        direccion: asString(body.direccion),
        referencia: asString(body.referencia),
        esPrincipal: Boolean(body.esPrincipal),
      },
    });
    return ok({ address });
  }
  return fail("Ruta no encontrada", 404);
}

async function accountPut(request: NextRequest, segments: string[]) {
  const session = await requireCustomer(request);
  if (!session) return fail("No autorizado", 401);
  const [, second, third] = segments;
  const body = await readJson(request);
  if (second === "perfil") {
    const user = await prisma.user.update({
      where: { id: session.id },
      data: {
        nombre: asString(body.nombre),
        apellido: asString(body.apellido),
        telefono: asString(body.telefono),
        dni: asString(body.dni),
        ruc: asString(body.ruc),
        nombreNegocio: asString(body.nombreNegocio),
        tipoNegocio: asString(body.tipoNegocio),
        departamento: asString(body.departamento),
        provincia: asString(body.provincia),
        distrito: asString(body.distrito),
        direccion: asString(body.direccion),
        referencia: asString(body.referencia),
      },
    });
    return ok({ user: { ...user, password: undefined } });
  }
  if (second === "direcciones" && third) {
    const ownAddress = await prisma.address.findFirst({ where: { id: third, userId: session.id } });
    if (!ownAddress) return fail("Direccion no encontrada", 404);
    const address = await prisma.address.update({
      where: { id: third },
      data: {
        alias: asString(body.alias),
        nombres: asString(body.nombres),
        telefono: asString(body.telefono),
        departamento: asString(body.departamento),
        provincia: asString(body.provincia),
        distrito: asString(body.distrito),
        direccion: asString(body.direccion),
        referencia: asString(body.referencia),
        esPrincipal: Boolean(body.esPrincipal),
      },
    });
    return ok({ address });
  }
  return fail("Ruta no encontrada", 404);
}

async function accountDelete(request: NextRequest, segments: string[]) {
  const session = await requireCustomer(request);
  if (!session) return fail("No autorizado", 401);
  const [, second, third] = segments;
  if (second === "direcciones" && third) {
    const ownAddress = await prisma.address.findFirst({ where: { id: third, userId: session.id } });
    if (!ownAddress) return fail("Direccion no encontrada", 404);
    await prisma.address.delete({ where: { id: third } });
    return ok({ ok: true });
  }
  return fail("Ruta no encontrada", 404);
}

async function adminGet(request: NextRequest, segments: string[]) {
  segments = normalizeSegments(segments);
  const [first, second, third] = segments;

  if (first === "me") {
    const session = await requireAdmin(request);
    if (!session) return ok({ admin: null });
    const admin = await prisma.adminUser.findUnique({ where: { id: session.id }, select: { password: false, id: true, nombre: true, email: true, rol: true, activo: true, ultimoAcceso: true } });
    return ok({ admin });
  }

  if (first === "auth" && second === "me") {
    const session = await requireAdmin(request);
    if (!session) return ok({ admin: null });
    const admin = await prisma.adminUser.findUnique({ where: { id: session.id }, select: { password: false, id: true, nombre: true, email: true, rol: true, activo: true, ultimoAcceso: true } });
    return ok({ admin });
  }

  const session = await requireAdmin(request);
  if (!session) return fail("No autorizado", 401);

  if (!first || first === "dashboard" || (first === "reportes" && second === "dashboard")) return ok(await dashboardReport());
  if (first === "pedidos") {
    if (second === "export") return exportOrders(request);
    if (second && third === "pdf") return adminOrderPdf(second);
    if (second) return orderDetail(second);
    return adminOrders(request);
  }
  if (first === "productos") {
    if (second === "export") return exportProducts();
    if (second) {
      const product = await prisma.product.findUnique({ where: { id: second }, include: { category: true, brand: true } });
      return product ? ok({ product }) : fail("Producto no encontrado", 404);
    }
    return listProducts(request, true);
  }
  if (first === "categorias") return ok({ categories: await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { orden: "asc" } }) });
  if (first === "marcas") return ok({ brands: await prisma.brand.findMany({ include: { _count: { select: { products: true } } }, orderBy: { orden: "asc" } }) });
  if (first === "banners") return ok({ banners: await prisma.banner.findMany({ orderBy: { orden: "asc" } }) });
  if (first === "cupones") return ok({ coupons: await prisma.coupon.findMany({ orderBy: [{ prioridad: "desc" }, { createdAt: "desc" }] }) });
  if (first === "bonificaciones") return ok({ bonuses: await prisma.bonus.findMany({ include: { cliente: { select: { id: true, nombre: true, apellido: true, nombreNegocio: true } } }, orderBy: { createdAt: "desc" } }) });
  if (first === "notificaciones") return ok({ notifications: await prisma.notification.findMany({ include: { cliente: { select: { id: true, nombre: true, apellido: true } } }, orderBy: { createdAt: "desc" } }) });
  if (first === "consolidado") return consolidatedReport(request, second);
  if (first === "clientes") {
    if (second) return customerDetail(second);
    return adminCustomers(request);
  }
  if (first === "reportes") return reports(second ?? "dashboard", request);
  if (first === "configuracion") {
    const settings = await prisma.setting.findMany({ orderBy: [{ grupo: "asc" }, { clave: "asc" }] });
    return ok({ settings });
  }
  if (first === "pedidos" && third) return orderDetail(third);

  return fail("Ruta admin no encontrada", 404);
}

async function adminPost(request: NextRequest, segments: string[]) {
  segments = normalizeSegments(segments);
  const [first, second, third] = segments;
  const ip = getIp(request);

  if ((first === "auth" && second === "login") || first === "login") {
    const limited = await checkRateLimit(getIp(request), "admin_login", 5, 15 * 60 * 1000);
    if (!limited.ok) return fail("Login bloqueado temporalmente", 429);
    const data = loginSchema.parse(await readJson(request));
    const admin = await prisma.adminUser.findUnique({ where: { email: data.email } });
    if (!admin || !admin.activo || !(await bcrypt.compare(data.password, admin.password))) {
      return fail("Credenciales invalidas", 401);
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { ultimoAcceso: new Date() } });
    await prisma.rateLimit.delete({ where: { ip_accion: { ip, accion: "admin_login" } } }).catch(() => null);
    const response = ok({ admin: { ...admin, password: undefined } });
    await setSessionCookie(response, { id: admin.id, email: admin.email, role: admin.rol, kind: "admin" });
    return response;
  }

  if (first === "auth" && second === "logout") {
    const response = ok({ ok: true });
    clearSessionCookie(response, "admin");
    return response;
  }

  const session = await requireAdmin(request);
  if (!session) return fail("No autorizado", 401);

  if (first === "productos") {
    if (second === "bulk") return productBulk(request);
    const body = productSchema.parse(await readJson(request));
    const slug = `${makeSlug(body.nombre)}-${body.codigoInterno.toLowerCase()}`;
    const product = await prisma.product.create({
      data: {
        ...body,
        slug,
        brandId: body.brandId || null,
        imagenes: JSON.stringify(body.imagenPrincipal ? [body.imagenPrincipal] : []),
        tags: JSON.stringify(body.tags),
        agotado: body.stock <= 0,
      },
    });
    return ok({ product }, { status: 201 });
  }

  if (first === "categorias") {
    const body = await readJson(request);
    const category = await prisma.category.create({
      data: {
        nombre: asString(body.nombre),
        slug: asString(body.slug) || makeSlug(asString(body.nombre)),
        descripcion: asString(body.descripcion),
        imagen: asString(body.imagen),
        icono: asString(body.icono, "Package"),
        padreId: asString(body.padreId) || null,
        orden: Number(body.orden ?? 0),
        activo: body.activo !== false,
      },
    });
    return ok({ category }, { status: 201 });
  }

  if (first === "marcas") {
    const body = await readJson(request);
    const brand = await prisma.brand.create({
      data: {
        nombre: asString(body.nombre),
        slug: asString(body.slug) || makeSlug(asString(body.nombre)),
        logo: asString(body.logo),
        descripcion: asString(body.descripcion),
        destacada: Boolean(body.destacada),
        orden: Number(body.orden ?? 0),
        activo: body.activo !== false,
      },
    });
    return ok({ brand }, { status: 201 });
  }

  if (first === "banners") {
    const body = await readJson(request);
    const banner = await prisma.banner.create({
      data: {
        titulo: asString(body.titulo),
        subtitulo: asString(body.subtitulo),
        descripcion: asString(body.descripcion),
        ctaTexto: asString(body.ctaTexto),
        ctaLink: asString(body.ctaLink),
        imagenDesktop: asString(body.imagenDesktop),
        imagenMobile: asString(body.imagenMobile),
        posicion: asString(body.posicion, "hero"),
        tipo: asString(body.tipo, "principal_home"),
        colorTexto: asString(body.colorTexto, "light"),
        activo: body.activo !== false,
        orden: Number(body.orden ?? 0),
        fechaInicio: dateOrNull(body.fechaInicio),
        fechaFin: dateOrNull(body.fechaFin),
      },
    });
    return ok({ banner }, { status: 201 });
  }

  if (first === "cupones") {
    const body = await readJson(request);
    const coupon = await prisma.coupon.create({ data: {
      codigo: asString(body.codigo).trim().toUpperCase(), descripcion: asString(body.descripcion), tipo: asString(body.tipo, "fijo"),
      valor: Number(body.valor ?? 0), regaloNombre: asString(body.regaloNombre) || null, usoUnico: Boolean(body.usoUnico),
      limitePorCliente: Math.max(1, Number(body.limitePorCliente ?? 1)), fechaInicio: dateOrNull(body.fechaInicio), fechaFin: dateOrNull(body.fechaFin),
      montoMinimo: Number(body.montoMinimo ?? 0), categoriasAplicables: jsonList(body.categoriasAplicables), marcasAplicables: jsonList(body.marcasAplicables),
      productosExcluidos: jsonList(body.productosExcluidos), activo: body.activo !== false, prioridad: Number(body.prioridad ?? 0),
      cantidadMaximaUsos: body.cantidadMaximaUsos ? Number(body.cantidadMaximaUsos) : null,
    } });
    return ok({ coupon }, { status: 201 });
  }

  if (first === "bonificaciones") {
    const body = await readJson(request);
    const bonus = await prisma.bonus.create({ data: {
      nombre: asString(body.nombre), codigoInterno: asString(body.codigoInterno) || null, descripcion: asString(body.descripcion) || null,
      imagen: asString(body.imagen) || null, condicionTipo: asString(body.condicionTipo, "monto"), condicionValor: Number(body.condicionValor ?? 0),
      categoryId: asString(body.categoryId) || null, brandId: asString(body.brandId) || null, clienteId: asString(body.clienteId) || null,
      beneficio: asString(body.beneficio), activo: body.activo !== false, fechaInicio: dateOrNull(body.fechaInicio), fechaFin: dateOrNull(body.fechaFin),
    } });
    return ok({ bonus }, { status: 201 });
  }

  if (first === "notificaciones") {
    const body = await readJson(request);
    const notification = await prisma.notification.create({ data: {
      titulo: asString(body.titulo), mensaje: asString(body.mensaje), tipo: asString(body.tipo, "aviso_home"),
      fechaInicio: dateOrNull(body.fechaInicio), fechaFin: dateOrNull(body.fechaFin), publico: asString(body.publico, "todos"),
      clienteId: asString(body.clienteId) || null, activo: body.activo !== false,
    } });
    return ok({ notification }, { status: 201 });
  }

  if (first === "pedidos" && second && third === "reenviar-email") {
    const order = await prisma.order.findUnique({ where: { id: second }, include: { items: true } });
    if (!order) return fail("Pedido no encontrado", 404);
    const result = await sendOrderEmails({
      numero: order.numero,
      clienteNombre: order.clienteNombre,
      clienteApellido: order.clienteApellido,
      clienteEmail: order.clienteEmail,
      clienteTelefono: order.clienteTelefono,
      entregaDireccion: order.entregaDireccion,
      metodoPago: order.metodoPago,
      total: order.total,
      items: order.items.map((item) => ({ nombre: item.nombre, cantidad: item.cantidad, subtotal: item.subtotal })),
    });
    await prisma.order.update({ where: { id: order.id }, data: { emailEnviado: true } });
    return ok({ result });
  }

  if (first === "pedidos" && second && third === "reenviar-whatsapp") {
    const settings = await getSettingsMap();
    const order = await prisma.order.findUnique({ where: { id: second }, include: { items: true } });
    if (!order) return fail("Pedido no encontrado", 404);
    const result = await sendOrderWhatsApp(
      {
        numero: order.numero,
        clienteNombre: order.clienteNombre,
        clienteApellido: order.clienteApellido,
        clienteEmail: order.clienteEmail,
        clienteTelefono: order.clienteTelefono,
        entregaDireccion: order.entregaDireccion,
        metodoPago: order.metodoPago,
        total: order.total,
        items: order.items.map((item) => ({ nombre: item.nombre, cantidad: item.cantidad, subtotal: item.subtotal })),
      },
      process.env.ADMIN_WHATSAPP ?? settings.get("whatsapp") ?? COMPANY.whatsappNumber,
      settings.get("mensaje_whatsapp_pedido") ?? undefined,
    );
    return ok({ result });
  }

  if (first === "clientes" && second && third === "bloquear") {
    const body = await readJson(request);
    const user = await prisma.user.update({
      where: { id: second },
      data: { bloqueado: Boolean(body.bloqueado), motivoBloqueo: asString(body.motivoBloqueo) },
    });
    return ok({ user: { ...user, password: undefined } });
  }

  if (first === "upload") return uploadFile(request);

  return fail("Ruta admin no encontrada", 404);
}

async function adminPut(request: NextRequest, segments: string[]) {
  const session = await requireAdmin(request);
  if (!session) return fail("No autorizado", 401);
  segments = normalizeSegments(segments);
  const [first, second, third] = segments;
  const body = await readJson(request);

  if (first === "pedidos" && second && (third === "estado" || third === "status")) {
    const estado = asString(body.estado);
    if (!ORDER_STATES.includes(estado as (typeof ORDER_STATES)[number])) return fail("Estado invalido", 400);
    const order = await prisma.order.update({
      where: { id: second },
      data: {
        estado,
        historial: { create: { estado, nota: asString(body.nota), userId: session.id } },
      },
      include: { historial: true, items: true },
    });
    return ok({ order });
  }

  if (first === "productos" && second) {
    const data = productSchema.partial().parse(body);
    const updateData: Prisma.ProductUpdateInput = {
      ...data,
      brand: data.brandId === undefined ? undefined : data.brandId ? { connect: { id: data.brandId } } : { disconnect: true },
      category: data.categoryId ? { connect: { id: data.categoryId } } : undefined,
      tags: data.tags ? JSON.stringify(data.tags) : undefined,
      imagenes: data.imagenPrincipal ? JSON.stringify([data.imagenPrincipal]) : undefined,
      agotado: data.stock === undefined ? undefined : data.stock <= 0,
    };
    delete (updateData as Data).brandId;
    delete (updateData as Data).categoryId;
    const product = await prisma.product.update({ where: { id: second }, data: updateData, include: { category: true, brand: true } });
    return ok({ product });
  }

  if (first === "categorias" && second === "reordenar") return reorder("category", asStringArray(body.ids));
  if (first === "marcas" && second === "reordenar") return reorder("brand", asStringArray(body.ids));
  if (first === "banners" && second === "reordenar") return reorder("banner", asStringArray(body.ids));

  if (first === "categorias" && second) {
    const category = await prisma.category.update({
      where: { id: second },
      data: {
        nombre: asString(body.nombre),
        slug: asString(body.slug),
        descripcion: asString(body.descripcion),
        imagen: asString(body.imagen),
        icono: asString(body.icono),
        padreId: asString(body.padreId) || null,
        orden: Number(body.orden ?? 0),
        activo: body.activo !== false,
      },
    });
    return ok({ category });
  }

  if (first === "marcas" && second) {
    const brand = await prisma.brand.update({
      where: { id: second },
      data: {
        nombre: asString(body.nombre),
        slug: asString(body.slug),
        logo: asString(body.logo),
        descripcion: asString(body.descripcion),
        destacada: Boolean(body.destacada),
        orden: Number(body.orden ?? 0),
        activo: body.activo !== false,
      },
    });
    return ok({ brand });
  }

  if (first === "banners" && second) {
    const banner = await prisma.banner.update({
      where: { id: second },
      data: {
        titulo: asString(body.titulo),
        subtitulo: asString(body.subtitulo),
        descripcion: asString(body.descripcion),
        ctaTexto: asString(body.ctaTexto),
        ctaLink: asString(body.ctaLink),
        imagenDesktop: asString(body.imagenDesktop),
        imagenMobile: asString(body.imagenMobile),
        posicion: asString(body.posicion),
        tipo: asString(body.tipo, "principal_home"),
        colorTexto: asString(body.colorTexto),
        activo: body.activo !== false,
        orden: Number(body.orden ?? 0),
        fechaInicio: dateOrNull(body.fechaInicio),
        fechaFin: dateOrNull(body.fechaFin),
      },
    });
    return ok({ banner });
  }
  if (first === "cupones" && second) {
    const coupon = await prisma.coupon.update({ where: { id: second }, data: {
      codigo: body.codigo === undefined ? undefined : asString(body.codigo).trim().toUpperCase(), descripcion: body.descripcion === undefined ? undefined : asString(body.descripcion),
      tipo: body.tipo === undefined ? undefined : asString(body.tipo), valor: body.valor === undefined ? undefined : Number(body.valor),
      regaloNombre: body.regaloNombre === undefined ? undefined : asString(body.regaloNombre) || null, usoUnico: body.usoUnico === undefined ? undefined : Boolean(body.usoUnico),
      limitePorCliente: body.limitePorCliente === undefined ? undefined : Math.max(1, Number(body.limitePorCliente)), fechaInicio: body.fechaInicio === undefined ? undefined : dateOrNull(body.fechaInicio),
      fechaFin: body.fechaFin === undefined ? undefined : dateOrNull(body.fechaFin), montoMinimo: body.montoMinimo === undefined ? undefined : Number(body.montoMinimo),
      categoriasAplicables: body.categoriasAplicables === undefined ? undefined : jsonList(body.categoriasAplicables), marcasAplicables: body.marcasAplicables === undefined ? undefined : jsonList(body.marcasAplicables),
      productosExcluidos: body.productosExcluidos === undefined ? undefined : jsonList(body.productosExcluidos), activo: body.activo === undefined ? undefined : Boolean(body.activo),
      prioridad: body.prioridad === undefined ? undefined : Number(body.prioridad), cantidadMaximaUsos: body.cantidadMaximaUsos === undefined ? undefined : body.cantidadMaximaUsos ? Number(body.cantidadMaximaUsos) : null,
    } });
    return ok({ coupon });
  }

  if (first === "bonificaciones" && second) {
    const bonus = await prisma.bonus.update({ where: { id: second }, data: {
      nombre: body.nombre === undefined ? undefined : asString(body.nombre), codigoInterno: body.codigoInterno === undefined ? undefined : asString(body.codigoInterno) || null,
      descripcion: body.descripcion === undefined ? undefined : asString(body.descripcion) || null, imagen: body.imagen === undefined ? undefined : asString(body.imagen) || null,
      condicionTipo: body.condicionTipo === undefined ? undefined : asString(body.condicionTipo), condicionValor: body.condicionValor === undefined ? undefined : Number(body.condicionValor),
      categoryId: body.categoryId === undefined ? undefined : asString(body.categoryId) || null, brandId: body.brandId === undefined ? undefined : asString(body.brandId) || null,
      clienteId: body.clienteId === undefined ? undefined : asString(body.clienteId) || null, beneficio: body.beneficio === undefined ? undefined : asString(body.beneficio),
      activo: body.activo === undefined ? undefined : Boolean(body.activo), fechaInicio: body.fechaInicio === undefined ? undefined : dateOrNull(body.fechaInicio), fechaFin: body.fechaFin === undefined ? undefined : dateOrNull(body.fechaFin),
    } });
    return ok({ bonus });
  }

  if (first === "notificaciones" && second) {
    const notification = await prisma.notification.update({ where: { id: second }, data: {
      titulo: body.titulo === undefined ? undefined : asString(body.titulo), mensaje: body.mensaje === undefined ? undefined : asString(body.mensaje),
      tipo: body.tipo === undefined ? undefined : asString(body.tipo), fechaInicio: body.fechaInicio === undefined ? undefined : dateOrNull(body.fechaInicio),
      fechaFin: body.fechaFin === undefined ? undefined : dateOrNull(body.fechaFin), publico: body.publico === undefined ? undefined : asString(body.publico),
      clienteId: body.clienteId === undefined ? undefined : asString(body.clienteId) || null, activo: body.activo === undefined ? undefined : Boolean(body.activo),
    } });
    return ok({ notification });
  }

  if (first === "clientes" && second && third === "beneficios") {
    const benefit = await prisma.customerBenefit.upsert({ where: { userId: second }, create: {
      userId: second, cuponExclusivo: asString(body.cuponExclusivo) || null, productoGratis: asString(body.productoGratis) || null,
      bonificacionEspecial: asString(body.bonificacionEspecial) || null, descuentoEspecial: Number(body.descuentoEspecial ?? 0),
      productosExcluidos: jsonList(body.productosExcluidos), productosExclusivos: jsonList(body.productosExclusivos), notasInternas: asString(body.notasInternas) || null,
      aplicarAutomatico: body.aplicarAutomatico !== false, activo: body.activo !== false,
    }, update: {
      cuponExclusivo: asString(body.cuponExclusivo) || null, productoGratis: asString(body.productoGratis) || null,
      bonificacionEspecial: asString(body.bonificacionEspecial) || null, descuentoEspecial: Number(body.descuentoEspecial ?? 0),
      productosExcluidos: jsonList(body.productosExcluidos), productosExclusivos: jsonList(body.productosExclusivos), notasInternas: asString(body.notasInternas) || null,
      aplicarAutomatico: body.aplicarAutomatico !== false, activo: body.activo !== false,
    } });
    return ok({ benefit });
  }

  if (first === "clientes" && second) {
    const user = await prisma.user.update({
      where: { id: second },
      data: {
        activo: body.activo !== false,
        bloqueado: Boolean(body.bloqueado),
        motivoBloqueo: asString(body.motivoBloqueo),
      },
    });
    return ok({ user: { ...user, password: undefined } });
  }

  if (first === "configuracion") {
    const entries = Array.isArray(body.settings)
      ? (body.settings as Array<{ clave: string; valor: string }>)
      : Object.entries(body).map(([clave, valor]) => ({ clave, valor: String(valor) }));
    await Promise.all(
      entries.map((entry) =>
        prisma.setting.upsert({
          where: { clave: entry.clave },
          create: { clave: entry.clave, valor: entry.valor },
          update: { valor: entry.valor },
        }),
      ),
    );
    return ok({ ok: true, settings: await prisma.setting.findMany({ orderBy: [{ grupo: "asc" }, { clave: "asc" }] }) });
  }

  return fail("Ruta admin no encontrada", 404);
}

async function adminDelete(request: NextRequest, segments: string[]) {
  const session = await requireAdmin(request);
  if (!session) return fail("No autorizado", 401);
  segments = normalizeSegments(segments);
  const [first, second] = segments;
  if (first === "productos" && second) {
    await prisma.product.delete({ where: { id: second } });
    return ok({ ok: true });
  }
  if (first === "categorias" && second) {
    await prisma.category.delete({ where: { id: second } });
    return ok({ ok: true });
  }
  if (first === "marcas" && second) {
    await prisma.brand.delete({ where: { id: second } });
    return ok({ ok: true });
  }
  if (first === "banners" && second) {
    await prisma.banner.delete({ where: { id: second } });
    return ok({ ok: true });
  }
  if (first === "cupones" && second) {
    await prisma.coupon.delete({ where: { id: second } });
    return ok({ ok: true });
  }
  if (first === "bonificaciones" && second) {
    await prisma.bonus.delete({ where: { id: second } });
    return ok({ ok: true });
  }
  if (first === "notificaciones" && second) {
    await prisma.notification.delete({ where: { id: second } });
    return ok({ ok: true });
  }
  return fail("Ruta admin no encontrada", 404);
}

async function reorder(kind: "category" | "brand" | "banner", ids: string[]) {
  await Promise.all(
    ids.map((id, index) => {
      if (kind === "category") return prisma.category.update({ where: { id }, data: { orden: index + 1 } });
      if (kind === "brand") return prisma.brand.update({ where: { id }, data: { orden: index + 1 } });
      return prisma.banner.update({ where: { id }, data: { orden: index + 1 } });
    }),
  );
  return ok({ ok: true });
}

async function productBulk(request: NextRequest) {
  const body = await readJson(request);
  const ids = asStringArray(body.ids);
  const action = asString(body.action);
  if (!ids.length) return fail("Selecciona productos", 400);
  if (action === "activar") await prisma.product.updateMany({ where: { id: { in: ids } }, data: { activo: true } });
  if (action === "desactivar") await prisma.product.updateMany({ where: { id: { in: ids } }, data: { activo: false } });
  if (action === "eliminar") await prisma.product.deleteMany({ where: { id: { in: ids } } });
  if (action === "categoria") await prisma.product.updateMany({ where: { id: { in: ids } }, data: { categoryId: asString(body.categoryId) } });
  return ok({ ok: true });
}

async function dashboardReport() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const last30 = new Date(today);
  last30.setDate(today.getDate() - 30);

  const [ordersToday, salesToday, salesYesterday, products, clients, lowProducts, lastOrders, periodOrders, topItems] =
    await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: today }, estado: { not: "cancelado" } }, _sum: { total: true } }),
      prisma.order.aggregate({ where: { createdAt: { gte: yesterday, lt: today }, estado: { not: "cancelado" } }, _sum: { total: true } }),
      prisma.product.count({ where: { activo: true } }),
      prisma.user.count({ where: { rol: "cliente" } }),
      prisma.product.findMany({ where: { activo: true }, select: { id: true, stock: true, stockMinimo: true } }),
      prisma.order.findMany({ include: { items: true }, orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.order.findMany({ where: { createdAt: { gte: last30 } }, include: { items: true } }),
      prisma.orderItem.groupBy({ by: ["productId", "nombre", "codigoInterno"], _sum: { cantidad: true, subtotal: true }, orderBy: { _sum: { cantidad: "desc" } }, take: 10 }),
    ]);

  const daily = new Map<string, { fecha: string; pedidos: number; ventas: number }>();
  for (const order of periodOrders) {
    const key = order.createdAt.toISOString().slice(0, 10);
    const current = daily.get(key) ?? { fecha: key, pedidos: 0, ventas: 0 };
    current.pedidos += 1;
    current.ventas += order.total;
    daily.set(key, current);
  }

  return {
    kpis: {
      pedidosHoy: ordersToday,
      ventasHoy: salesToday._sum.total ?? 0,
      ventasAyer: salesYesterday._sum.total ?? 0,
      productos: products,
      clientes: clients,
      stockBajo: lowProducts.filter((product) => product.stock <= product.stockMinimo).length,
      sinStock: lowProducts.filter((product) => product.stock <= 0).length,
    },
    lastOrders,
    charts: {
      daily: Array.from(daily.values()).sort((a, b) => a.fecha.localeCompare(b.fecha)),
      topProducts: topItems.map((item) => ({
        productId: item.productId,
        codigoInterno: item.codigoInterno,
        nombre: item.nombre,
        cantidad: item._sum.cantidad ?? 0,
        ingresos: item._sum.subtotal ?? 0,
      })),
    },
  };
}

function orderDateFilter(search: URLSearchParams) {
  const period = search.get("periodo");
  const month = search.get("mes");
  const now = new Date();
  let from: Date | undefined;
  let to: Date | undefined;
  if (period === "hoy") {
    from = new Date(now); from.setHours(0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  }
  if (period === "semana") {
    from = new Date(now); from.setDate(now.getDate() - 6); from.setHours(0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  }
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [year, monthNumber] = month.split("-").map(Number);
    from = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
    to = new Date(year, monthNumber, 0, 23, 59, 59, 999);
  }
  const fromText = search.get("desde");
  const toText = search.get("hasta");
  if (fromText) {
    from = new Date(`${fromText}T${search.get("horaDesde") || "00:00"}:00`);
  }
  if (toText) {
    to = new Date(`${toText}T${search.get("horaHasta") || "23:59"}:59`);
  }
  return { from, to, filter: from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined };
}

async function consolidatedReport(request: NextRequest, format?: string) {
  const search = request.nextUrl.searchParams;
  const dates = orderDateFilter(search);
  const orders = await prisma.order.findMany({
    where: {
      ...(dates.filter ? { createdAt: dates.filter } : {}),
      ...(search.get("estado") ? { estado: search.get("estado") as string } : { estado: { not: "cancelado" } }),
      ...(search.get("clienteId") ? { userId: search.get("clienteId") as string } : {}),
    },
    include: { items: { include: { product: { include: { category: true, brand: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const grouped = new Map<string, ConsolidatedRow & { orderIds: Set<string> }>();
  for (const order of orders) {
    for (const item of order.items) {
      const current = grouped.get(item.productId) ?? {
        codigo: item.codigoInterno, producto: item.nombre, categoria: item.product.category.nombre,
        marca: item.marca || item.product.brand?.nombre || "-", unidad: item.product.unidad,
        cantidad: 0, precioReferencial: item.precio, subtotal: 0, pedidos: 0,
        observacion: "", orderIds: new Set<string>(),
      };
      current.cantidad += item.cantidad;
      current.subtotal += item.subtotal;
      current.orderIds.add(order.id);
      current.pedidos = current.orderIds.size;
      current.observacion = item.product.stock < current.cantidad || item.product.stock <= item.product.stockMinimo ? "Stock bajo" : "";
      grouped.set(item.productId, current);
    }
  }
  const rows = Array.from(grouped.values()).map((entry) => ({
    codigo: entry.codigo, producto: entry.producto, categoria: entry.categoria, marca: entry.marca,
    unidad: entry.unidad, cantidad: entry.cantidad, precioReferencial: entry.precioReferencial,
    subtotal: entry.subtotal, pedidos: entry.pedidos, observacion: entry.observacion,
  })).sort((a, b) => b.cantidad - a.cantidad);
  const fromLabel = dates.from?.toLocaleString("es-PE") || "Inicio";
  const toLabel = dates.to?.toLocaleString("es-PE") || "Ahora";
  const total = rows.reduce((sum, row) => sum + row.subtotal, 0);
  if (format === "csv") {
    const csv = toCsv(rows);
    return new NextResponse(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=consolidado-carga-global-norte.csv" } });
  }
  if (format === "pdf") {
    const pdf = await createConsolidatedPdf({ rows, from: fromLabel, to: toLabel, orderCount: orders.length, total });
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=consolidado-carga-global-norte.pdf" } });
  }
  return ok({ rows, summary: { orders: orders.length, products: rows.length, total, from: fromLabel, to: toLabel } });
}

async function adminOrders(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const where: Prisma.OrderWhereInput = {};
  const estado = search.get("estado");
  const metodoPago = search.get("metodoPago");
  const q = search.get("q")?.trim();
  if (estado) where.estado = estado;
  if (metodoPago) where.metodoPago = metodoPago;
  const dates = orderDateFilter(search);
  if (dates.filter) where.createdAt = dates.filter;
  if (search.get("metodoEntrega")) where.metodoEntrega = search.get("metodoEntrega") as string;
  const totalMin = search.get("totalMin") ? Number(search.get("totalMin")) : Number.NaN;
  const totalMax = search.get("totalMax") ? Number(search.get("totalMax")) : Number.NaN;
  if (!Number.isNaN(totalMin) || !Number.isNaN(totalMax)) where.total = { ...(Number.isNaN(totalMin) ? {} : { gte: totalMin }), ...(Number.isNaN(totalMax) ? {} : { lte: totalMax }) };
  if (search.get("clienteId")) where.userId = search.get("clienteId") as string;
  if (q) {
    where.OR = [
      { numero: { contains: q } },
      { clienteNombre: { contains: q } },
      { clienteApellido: { contains: q } },
      { clienteTelefono: { contains: q } },
    ];
  }
  const [orders, total, sum] = await Promise.all([
    prisma.order.findMany({ where, include: { items: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.order.count({ where }),
    prisma.order.aggregate({ where, _sum: { total: true }, _avg: { total: true } }),
  ]);
  const productTotals = new Map<string, { nombre: string; cantidad: number }>();
  const customerTotals = new Map<string, { cliente: string; pedidos: number }>();
  for (const order of orders) {
    const customerKey = order.userId || order.clienteTelefono;
    const customer = customerTotals.get(customerKey) ?? { cliente: order.clienteNegocio || `${order.clienteNombre} ${order.clienteApellido}`, pedidos: 0 };
    customer.pedidos += 1; customerTotals.set(customerKey, customer);
    for (const item of order.items) {
      const product = productTotals.get(item.productId) ?? { nombre: item.nombre, cantidad: 0 };
      product.cantidad += item.cantidad; productTotals.set(item.productId, product);
    }
  }
  return ok({ orders, stats: { totalVentas: sum._sum.total ?? 0, pedidos: total, ticketPromedio: sum._avg.total ?? 0, entregados: orders.filter((order) => order.estado === "entregado").length }, month: {
    topProducts: Array.from(productTotals.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5),
    topCustomers: Array.from(customerTotals.values()).sort((a, b) => b.pedidos - a.pedidos).slice(0, 5),
  } });
}

async function orderDetail(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, historial: { orderBy: { createdAt: "asc" } } },
  });
  return order ? ok({ order }) : fail("Pedido no encontrado", 404);
}

async function adminOrderPdf(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, historial: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) return fail("Pedido no encontrado", 404);
  const pdfUrl = await createAdminOrderPdf(order);
  const filePath = path.join(process.cwd(), "public", pdfUrl.replace(/^\//, ""));
  const file = await fs.readFile(filePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="proforma-${order.numero}.pdf"`,
    },
  });
}

async function exportOrders(request: NextRequest) {
  const response = await adminOrders(request);
  const payload = (await response.json()) as { orders: Array<{ numero: string; clienteNombre: string; clienteApellido: string; total: number; metodoPago: string; estado: string; createdAt: string }> };
  const csv = toCsv(payload.orders.map((order) => ({ numero: order.numero, cliente: `${order.clienteNombre} ${order.clienteApellido}`, total: order.total, metodoPago: order.metodoPago, estado: order.estado, fecha: order.createdAt })));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=pedidos.csv" } });
}

async function exportProducts() {
  const products = await prisma.product.findMany({ include: { category: true, brand: true }, orderBy: { codigoInterno: "asc" } });
  const csv = toCsv(products.map((product) => ({ codigo: product.codigoInterno, nombre: product.nombre, categoria: product.category.nombre, marca: product.brand?.nombre ?? "", precioUnitario: product.precioUnitario, precioCaja: product.precioCaja ?? "", stock: product.stock, activo: product.activo })));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=inventario-global-norte.csv" } });
}

async function adminCustomers(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const users = await prisma.user.findMany({
    where: {
      rol: "cliente",
      ...(q
        ? {
            OR: [
              { nombre: { contains: q } },
              { apellido: { contains: q } },
              { email: { contains: q } },
              { telefono: { contains: q } },
              { nombreNegocio: { contains: q } },
            ],
          }
        : {}),
    },
    include: { orders: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok({ users: users.map((user) => ({ ...user, password: undefined, totalComprado: user.orders.reduce((sum, order) => sum + order.total, 0), pedidos: user.orders.length })) });
}

async function customerDetail(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, include: { orders: { include: { items: true }, orderBy: { createdAt: "desc" } }, addresses: true, benefit: true } });
  if (!user) return fail("Cliente no encontrado", 404);
  return ok({ user: { ...user, password: undefined, totalComprado: user.orders.reduce((sum, order) => sum + order.total, 0) } });
}

async function reports(kind: string, request: NextRequest) {
  if (kind === "dashboard") return ok(await dashboardReport());
  const days = Number(request.nextUrl.searchParams.get("dias") ?? "30");
  const from = new Date();
  from.setDate(from.getDate() - days);

  if (kind === "ventas") {
    const orders = await prisma.order.findMany({ where: { createdAt: { gte: from }, estado: { not: "cancelado" } }, orderBy: { createdAt: "asc" } });
    const daily = new Map<string, { fecha: string; pedidos: number; ventas: number }>();
    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const current = daily.get(key) ?? { fecha: key, pedidos: 0, ventas: 0 };
      current.pedidos += 1;
      current.ventas += order.total;
      daily.set(key, current);
    }
    return ok({ rows: Array.from(daily.values()), total: orders.reduce((sum, order) => sum + order.total, 0), pedidos: orders.length });
  }

  if (kind === "productos") {
    const top = await prisma.orderItem.groupBy({ by: ["productId", "codigoInterno", "nombre"], _sum: { cantidad: true, subtotal: true }, orderBy: { _sum: { cantidad: "desc" } }, take: 20 });
    return ok({ rows: top.map((item) => ({ productId: item.productId, codigoInterno: item.codigoInterno, nombre: item.nombre, unidades: item._sum.cantidad ?? 0, ingresos: item._sum.subtotal ?? 0 })) });
  }

  if (kind === "categorias") {
    const items = await prisma.orderItem.findMany({ include: { product: { include: { category: true } } } });
    const grouped = new Map<string, { categoria: string; ingresos: number; unidades: number }>();
    for (const item of items) {
      const key = item.product.category.nombre;
      const current = grouped.get(key) ?? { categoria: key, ingresos: 0, unidades: 0 };
      current.ingresos += item.subtotal;
      current.unidades += item.cantidad;
      grouped.set(key, current);
    }
    return ok({ rows: Array.from(grouped.values()).sort((a, b) => b.ingresos - a.ingresos) });
  }

  if (kind === "clientes") {
    const users = await prisma.user.findMany({ where: { rol: "cliente" }, include: { orders: true } });
    return ok({ rows: users.map((user) => ({ id: user.id, cliente: `${user.nombre} ${user.apellido}`, pedidos: user.orders.length, total: user.orders.reduce((sum, order) => sum + order.total, 0) })).sort((a, b) => b.total - a.total).slice(0, 10) });
  }

  if (kind === "inventario") {
    const products = await prisma.product.findMany({ include: { category: true, brand: true } });
    return ok({
      stockBajo: products.filter((product) => product.stock <= product.stockMinimo),
      agotados: products.filter((product) => product.stock <= 0),
      valorTotal: products.reduce((sum, product) => sum + product.stock * product.precioUnitario, 0),
    });
  }

  return fail("Reporte no encontrado", 404);
}

async function uploadFile(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return fail("No autorizado", 401);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Archivo no enviado", 400);
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return fail("Formato no permitido. Usa JPG, PNG o WEBP", 400);
  const max = Number(process.env.MAX_FILE_SIZE ?? 10485760);
  if (file.size > max) return fail("Archivo demasiado grande", 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  const folder = asString(form.get("folder"), "general").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "general";
  const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? "./public/uploads");
  const uploadDir = path.join(uploadRoot, folder);
  await fs.mkdir(uploadDir, { recursive: true });
  const baseName = `${Date.now()}-${makeSlug(file.name.replace(/\.[^.]+$/, ""))}`;
  let name = `${baseName}.webp`;
  let fullPath = path.join(uploadDir, name);
  try {
    await sharp(buffer).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toFile(fullPath);
  } catch {
    const extensionByType: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    name = `${baseName}.${extensionByType[file.type] ?? "jpg"}`;
    fullPath = path.join(uploadDir, name);
    await fs.writeFile(fullPath, buffer);
  }
  return ok({ success: true, data: { url: `/uploads/${folder}/${name}` }, url: `/uploads/${folder}/${name}` });
}

export async function GET(request: NextRequest, context: Params) {
  try {
    return await publicGet(request, context.params.path ?? []);
  } catch (error) {
    console.error(error);
    return fail(error instanceof Error ? error.message : "Error interno", 500);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    return await publicPost(request, context.params.path ?? []);
  } catch (error) {
    console.error(error);
    if (error instanceof z.ZodError) return fail("Datos invalidos", 422, { issues: error.issues });
    return fail(error instanceof Error ? error.message : "Error interno", 500);
  }
}

export async function PUT(request: NextRequest, context: Params) {
  try {
    return await publicPut(request, context.params.path ?? []);
  } catch (error) {
    console.error(error);
    if (error instanceof z.ZodError) return fail("Datos invalidos", 422, { issues: error.issues });
    return fail(error instanceof Error ? error.message : "Error interno", 500);
  }
}

export async function PATCH(request: NextRequest, context: Params) {
  return PUT(request, context);
}

export async function DELETE(request: NextRequest, context: Params) {
  try {
    return await publicDelete(request, context.params.path ?? []);
  } catch (error) {
    console.error(error);
    return fail(error instanceof Error ? error.message : "Error interno", 500);
  }
}
