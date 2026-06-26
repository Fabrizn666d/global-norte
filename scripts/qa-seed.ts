import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { prisma } from "@/lib/db";

const runId = process.env.QA_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const prefix = `TEST QA ${runId}`;
const safePrefix = `TESTQA${runId}`;

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function daysAgo(days: number, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 15, 0, 0);
  return date;
}

function previousMonth(hour = 11) {
  const date = new Date();
  date.setMonth(date.getMonth() - 1, 12);
  date.setHours(hour, 30, 0, 0);
  return date;
}

async function ensureQaImage() {
  const source = path.join(process.cwd(), "public", "brand", "global-norte-logo.jpg");
  const dir = path.join(process.cwd(), "public", "uploads", "products", "qa");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safePrefix.toLowerCase()}-producto.webp`);
  await sharp(source).resize({ width: 600, height: 600, fit: "contain", background: "#ffffff" }).webp({ quality: 86 }).toFile(file);
  return `/uploads/products/qa/${path.basename(file)}`;
}

async function upsertProduct(data: {
  code: string;
  name: string;
  categoryId: string;
  brandId: string;
  image?: string | null;
  destacado?: boolean;
  mostrarEnHome?: boolean;
  enOferta?: boolean;
  nuevo?: boolean;
  agotado?: boolean;
  price?: number;
}) {
  return prisma.product.upsert({
    where: { codigoInterno: data.code },
    create: {
      codigoInterno: data.code,
      nombre: data.name,
      slug: slug(data.code),
      descripcion: `${prefix} - producto de auditoria removible.`,
      categoryId: data.categoryId,
      brandId: data.brandId,
      precioUnitario: data.price ?? 7.5,
      precioCaja: (data.price ?? 7.5) * 10,
      unidadesPorCaja: 10,
      etiquetaCaja: "Caja x 10",
      stock: data.agotado ? 0 : 1,
      stockMinimo: 1,
      imagenPrincipal: data.image,
      imagenes: data.image ? JSON.stringify([data.image]) : "[]",
      activo: true,
      destacado: data.destacado ?? false,
      mostrarEnHome: data.mostrarEnHome ?? false,
      enOferta: data.enOferta ?? false,
      precioAnterior: data.enOferta ? (data.price ?? 7.5) + 2 : null,
      nuevo: data.nuevo ?? false,
      agotado: data.agotado ?? false,
      tags: JSON.stringify(["test", "qa", runId]),
    },
    update: {
      nombre: data.name,
      categoryId: data.categoryId,
      brandId: data.brandId,
      precioUnitario: data.price ?? 7.5,
      precioCaja: (data.price ?? 7.5) * 10,
      unidadesPorCaja: 10,
      etiquetaCaja: "Caja x 10",
      stock: data.agotado ? 0 : 1,
      stockMinimo: 1,
      imagenPrincipal: data.image,
      imagenes: data.image ? JSON.stringify([data.image]) : "[]",
      activo: true,
      destacado: data.destacado ?? false,
      mostrarEnHome: data.mostrarEnHome ?? false,
      enOferta: data.enOferta ?? false,
      precioAnterior: data.enOferta ? (data.price ?? 7.5) + 2 : null,
      nuevo: data.nuevo ?? false,
      agotado: data.agotado ?? false,
      tags: JSON.stringify(["test", "qa", runId]),
    },
  });
}

async function createOrder(params: {
  index: number;
  userId?: string;
  products: Awaited<ReturnType<typeof upsertProduct>>[];
  date: Date;
  estado: string;
  metodoPago: string;
  couponCode?: string;
  guest?: boolean;
}) {
  const subtotal = params.products.reduce((sum, product, index) => sum + product.precioUnitario * (index + params.index + 1), 0);
  const descuento = params.couponCode ? Math.min(8, subtotal * 0.1) : 0;
  const order = await prisma.order.upsert({
    where: { numero: `${safePrefix}-${String(params.index).padStart(2, "0")}` },
    create: {
      numero: `${safePrefix}-${String(params.index).padStart(2, "0")}`,
      userId: params.userId,
      clienteNombre: params.guest ? "Cliente" : "QA",
      clienteApellido: params.guest ? "Invitado TEST QA" : "Registrado TEST QA",
      clienteEmail: params.guest ? `${safePrefix.toLowerCase()}-guest-${params.index}@globalnorte.test` : `${safePrefix.toLowerCase()}@globalnorte.test`,
      clienteTelefono: `91817${String(1000 + params.index).slice(-4)}`,
      clienteNegocio: params.guest ? "Cliente Invitado TEST QA" : `${prefix} Bodega registrada`,
      entregaDireccion: `Av. ${prefix} ${params.index}`,
      entregaDistrito: params.index % 2 ? "Comas" : "Los Olivos",
      entregaProvincia: "Lima",
      entregaDepartamento: "Lima",
      entregaReferencia: `Referencia TEST QA ${params.index}`,
      entregaMapsUrl: `https://maps.google.com/?q=-11.${90 + params.index},-77.${10 + params.index}`,
      metodoEntrega: "coordinada",
      estado: params.estado,
      metodoPago: params.metodoPago,
      subtotal,
      descuento,
      cuponCodigo: params.couponCode,
      cuponDescripcion: params.couponCode ? "Cupon TEST QA aplicado" : null,
      bonificaciones: JSON.stringify([{ source: "bonus", code: `${safePrefix}-BONO`, name: `${prefix} Bonificacion`, description: "Regalo de prueba QA", quantity: 1, price: 0 }]),
      total: subtotal - descuento,
      notasCliente: `Observacion TEST QA ${params.index}`,
      notasInternas: `Nota interna TEST QA ${params.index}`,
      createdAt: params.date,
      updatedAt: params.date,
      items: {
        create: params.products.map((product, productIndex) => {
          const cantidad = productIndex + params.index + 1;
          return {
            productId: product.id,
            codigoInterno: product.codigoInterno,
            nombre: product.nombre,
            marca: `${prefix} Marca`,
            imagen: product.imagenPrincipal,
            tipoPrecio: "unidad",
            precio: product.precioUnitario,
            cantidad,
            subtotal: product.precioUnitario * cantidad,
          };
        }),
      },
      historial: { create: { estado: params.estado, nota: `Estado inicial TEST QA ${params.estado}`, createdAt: params.date } },
    },
    update: {
      estado: params.estado,
      metodoPago: params.metodoPago,
      createdAt: params.date,
      updatedAt: params.date,
      subtotal,
      descuento,
      total: subtotal - descuento,
      notasCliente: `Observacion TEST QA ${params.index}`,
      notasInternas: `Nota interna TEST QA ${params.index}`,
    },
  });
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.orderItem.createMany({
    data: params.products.map((product, productIndex) => {
      const cantidad = productIndex + params.index + 1;
      return {
        orderId: order.id,
        productId: product.id,
        codigoInterno: product.codigoInterno,
        nombre: product.nombre,
        marca: `${prefix} Marca`,
        imagen: product.imagenPrincipal,
        tipoPrecio: "unidad",
        precio: product.precioUnitario,
        cantidad,
        subtotal: product.precioUnitario * cantidad,
      };
    }),
  });
  return order;
}

async function main() {
  const image = await ensureQaImage();
  const category = await prisma.category.upsert({
    where: { slug: slug(`${safePrefix}-categoria`) },
    create: { nombre: `${prefix} Categoria`, slug: slug(`${safePrefix}-categoria`), descripcion: "Categoria removible TEST QA", activo: true, orden: 999 },
    update: { nombre: `${prefix} Categoria`, activo: true },
  });
  const brand = await prisma.brand.upsert({
    where: { slug: slug(`${safePrefix}-marca`) },
    create: { nombre: `${prefix} Marca`, slug: slug(`${safePrefix}-marca`), descripcion: "Marca removible TEST QA", activo: true, orden: 999 },
    update: { nombre: `${prefix} Marca`, activo: true },
  });
  const products = await Promise.all([
    upsertProduct({ code: `${safePrefix}-DEST`, name: `${prefix} Producto destacado`, categoryId: category.id, brandId: brand.id, image, destacado: true, mostrarEnHome: true, price: 8 }),
    upsertProduct({ code: `${safePrefix}-NEW`, name: `${prefix} Producto nuevo`, categoryId: category.id, brandId: brand.id, image, nuevo: true, price: 9 }),
    upsertProduct({ code: `${safePrefix}-OFFER`, name: `${prefix} Producto oferta`, categoryId: category.id, brandId: brand.id, image, enOferta: true, price: 6 }),
    upsertProduct({ code: `${safePrefix}-NOSTOCK`, name: `${prefix} Producto sin stock`, categoryId: category.id, brandId: brand.id, image, agotado: true, price: 5 }),
    upsertProduct({ code: `${safePrefix}-NOIMG`, name: `${prefix} Producto sin imagen`, categoryId: category.id, brandId: brand.id, image: null, price: 4 }),
  ]);

  const password = await bcrypt.hash("ClienteQA2026!", 12);
  const user = await prisma.user.upsert({
    where: { email: `${safePrefix.toLowerCase()}@globalnorte.test` },
    create: {
      nombre: "QA",
      apellido: "Registrado TEST QA",
      email: `${safePrefix.toLowerCase()}@globalnorte.test`,
      password,
      telefono: `91817${runId.slice(-4)}`,
      nombreNegocio: `${prefix} Bodega registrada`,
      tipoNegocio: "bodega",
      departamento: "Lima",
      provincia: "Lima",
      distrito: "Comas",
      direccion: `Av. ${prefix}`,
      referencia: "Frente a referencia QA",
      rol: "cliente",
      activo: true,
    },
    update: { activo: true, bloqueado: false, password },
  });

  await prisma.customerBenefit.upsert({
    where: { userId: user.id },
    create: { userId: user.id, cuponExclusivo: `${safePrefix}-FIX`, productoGratis: `${prefix} Regalo cliente`, bonificacionEspecial: "Beneficio especial TEST QA", descuentoEspecial: 3, activo: true },
    update: { cuponExclusivo: `${safePrefix}-FIX`, productoGratis: `${prefix} Regalo cliente`, bonificacionEspecial: "Beneficio especial TEST QA", descuentoEspecial: 3, activo: true },
  });

  const now = new Date();
  const future = new Date(now); future.setDate(now.getDate() + 15);
  const expiredStart = new Date(now); expiredStart.setDate(now.getDate() - 30);
  const expiredEnd = new Date(now); expiredEnd.setDate(now.getDate() - 3);
  const couponData = [
    [`${safePrefix}-FIX`, "fijo", 5, true, null, null],
    [`${safePrefix}-GUEST`, "fijo", 2, true, null, null],
    [`${safePrefix}-PCT`, "porcentaje", 10, true, null, null],
    [`${safePrefix}-MIN`, "fijo", 3, true, null, null],
    [`${safePrefix}-UNICO`, "fijo", 2, true, null, null],
    [`${safePrefix}-CAT`, "porcentaje", 8, true, null, null],
    [`${safePrefix}-BRAND`, "porcentaje", 8, true, null, null],
    [`${safePrefix}-VENCIDO`, "fijo", 4, true, expiredStart, expiredEnd],
    [`${safePrefix}-FUTURO`, "fijo", 4, true, future, null],
    [`${safePrefix}-INACTIVO`, "fijo", 4, false, null, null],
  ] as const;
  for (const [codigo, tipo, valor, activo, fechaInicio, fechaFin] of couponData) {
    await prisma.coupon.upsert({
      where: { codigo },
      create: {
        codigo,
        descripcion: `${prefix} Cupon ${codigo}`,
        tipo,
        valor,
        activo,
        fechaInicio,
        fechaFin,
        montoMinimo: codigo.endsWith("-MIN") ? 50 : 0,
        usoUnico: codigo.endsWith("-UNICO"),
        limitePorCliente: codigo.endsWith("-UNICO") || codigo.endsWith("-GUEST") ? 1 : 99,
        categoriasAplicables: codigo.endsWith("-CAT") ? JSON.stringify([category.id]) : "[]",
        marcasAplicables: codigo.endsWith("-BRAND") ? JSON.stringify([brand.id]) : "[]",
      },
      update: { descripcion: `${prefix} Cupon ${codigo}`, tipo, valor, activo, fechaInicio, fechaFin },
    });
  }

  const bonuses = [
    { nombre: `${prefix} Bono monto`, codigoInterno: `${safePrefix}-BONO-MONTO`, condicionTipo: "monto", condicionValor: 20, beneficio: "Regalo por monto TEST QA", activo: true },
    { nombre: `${prefix} Bono categoria`, codigoInterno: `${safePrefix}-BONO-CAT`, condicionTipo: "categoria", condicionValor: 1, categoryId: category.id, beneficio: "Regalo por categoria TEST QA", activo: true },
    { nombre: `${prefix} Bono cliente`, codigoInterno: `${safePrefix}-BONO-CLI`, condicionTipo: "monto", condicionValor: 1, clienteId: user.id, beneficio: "Regalo por cliente TEST QA", activo: true },
    { nombre: `${prefix} Bono inactivo`, codigoInterno: `${safePrefix}-BONO-OFF`, condicionTipo: "monto", condicionValor: 1, beneficio: "No debe aplicar", activo: false },
  ];
  for (const bonus of bonuses) {
    const existing = await prisma.bonus.findFirst({ where: { codigoInterno: bonus.codigoInterno } });
    if (existing) await prisma.bonus.update({ where: { id: existing.id }, data: bonus });
    else await prisma.bonus.create({ data: bonus });
  }

  await prisma.banner.createMany({
    data: [
      { titulo: `${prefix} Banner activo home`, subtitulo: "Activo hoy", descripcion: "Banner TEST QA visible", ctaTexto: "Ver catalogo", ctaLink: "/catalogo", imagenDesktop: image, imagenMobile: image, posicion: "hero", tipo: "principal_home", activo: true, orden: 998, fechaInicio: expiredStart, fechaFin: future },
      { titulo: `${prefix} Banner futuro`, subtitulo: "No visible aun", imagenDesktop: image, posicion: "hero", tipo: "principal_home", activo: true, orden: 999, fechaInicio: future },
      { titulo: `${prefix} Banner vencido`, subtitulo: "No visible", imagenDesktop: image, posicion: "catalogo", tipo: "catalogo", activo: true, orden: 999, fechaInicio: expiredStart, fechaFin: expiredEnd },
      { titulo: `${prefix} Banner carrito`, subtitulo: "Visible en carrito", imagenDesktop: image, posicion: "carrito", tipo: "carrito", activo: true, orden: 999, fechaInicio: expiredStart, fechaFin: future },
    ],
  });

  await prisma.notification.createMany({
    data: [
      { titulo: `${prefix} Notificacion activa`, mensaje: "Hola {nombre}, aviso TEST QA activo", tipo: "banner", publico: "todos", activo: true, fechaInicio: expiredStart, fechaFin: future },
      { titulo: `${prefix} Popup activo`, mensaje: "Popup TEST QA activo", tipo: "popup", publico: "todos", activo: true, fechaInicio: expiredStart, fechaFin: future },
      { titulo: `${prefix} Notificacion futura`, mensaje: "No debe aparecer aun", tipo: "aviso_home", publico: "todos", activo: true, fechaInicio: future },
      { titulo: `${prefix} Notificacion vencida`, mensaje: "No debe aparecer", tipo: "aviso_carrito", publico: "todos", activo: true, fechaInicio: expiredStart, fechaFin: expiredEnd },
      { titulo: `${prefix} Notificacion cliente`, mensaje: "Aviso cliente especifico TEST QA", tipo: "banner", publico: "cliente", clienteId: user.id, activo: true, fechaInicio: expiredStart, fechaFin: future },
    ],
  });

  const states = ["nuevo", "en_revision", "confirmado", "preparando", "entregado", "cancelado"];
  const dates = [daysAgo(0, 8), daysAgo(1, 13), daysAgo(7, 16), daysAgo(3, 20), previousMonth(9), daysAgo(0, 22)];
  const payments = ["efectivo", "yape", "transferencia", "plin", "efectivo", "transferencia"];
  for (let index = 0; index < states.length; index += 1) {
    await createOrder({
      index: index + 1,
      userId: index % 2 === 0 ? user.id : undefined,
      guest: index % 2 !== 0,
      products: products.slice(0, 3),
      date: dates[index],
      estado: states[index],
      metodoPago: payments[index],
      couponCode: index < 3 ? `${safePrefix}-FIX` : undefined,
    });
  }

  await prisma.activityLog.create({ data: { accion: "qa_seed", modulo: "qa", detalle: `${prefix} creado con productos, pedidos, cupones, bonos, banners y notificaciones.` } });

  console.log(`[qa:seed] Run ID: ${runId}`);
  console.log(`[qa:seed] Cliente: ${safePrefix.toLowerCase()}@globalnorte.test / ClienteQA2026!`);
  console.log(`[qa:seed] Productos: ${products.map((item) => item.codigoInterno).join(", ")}`);
  console.log(`[qa:seed] Pedidos: ${states.length}`);
  console.log(`[qa:seed] Todo marcado con: ${prefix}`);
}

main()
  .catch((error) => {
    console.error("[qa:seed] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
