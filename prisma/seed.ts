import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { COMPANY } from "../lib/company";
import inventory from "./inventory.json";

const prisma = new PrismaClient();
const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;

const settings = [
  { clave: "nombre_empresa", valor: "Distribuidora Global Norte E.I.R.L.", grupo: "general", label: "Nombre de la empresa" },
  { clave: "razon_social", valor: "Distribuidora Global Norte E.I.R.L.", grupo: "general", label: "Razon social" },
  { clave: "ruc", valor: "20608628461", grupo: "general", label: "RUC" },
  { clave: "direccion", valor: "MZ. A LT. 15 A.H. RAFAEL BELAUNDE - Lima - Carabayllo", grupo: "general", label: "Direccion" },
  { clave: "logo_url", valor: "/brand/global-norte-logo.jpg", grupo: "general", label: "Logo" },
  { clave: "telefono", valor: COMPANY.whatsappDisplay, grupo: "contacto", label: "Telefono" },
  { clave: "whatsapp", valor: COMPANY.whatsappNumber, grupo: "contacto", label: "WhatsApp" },
  { clave: "email", valor: "globalnorte@gmail.com", grupo: "contacto", label: "Email de contacto" },
  { clave: "email_admin", valor: "admin@globalnorte.pe", grupo: "contacto", label: "Email para pedidos" },
  { clave: "moneda", valor: "S/", grupo: "tienda", label: "Moneda" },
  { clave: "productos_por_pagina", valor: "24", tipo: "number", grupo: "tienda", label: "Productos por pagina" },
  { clave: "metodos_pago", valor: JSON.stringify(["efectivo", "transferencia", "yape", "plin"]), tipo: "json", grupo: "tienda", label: "Metodos de pago" },
  { clave: "datos_bancarios", valor: "BCP Cuenta corriente: completar en configuracion.", grupo: "tienda", label: "Datos bancarios" },
  {
    clave: "mensaje_whatsapp_pedido",
    valor:
      "*NUEVO PEDIDO #{numero}*\n{fecha}\n\nCliente: {nombre}\nTelefono: {telefono}\nDireccion: {direccion}\nPago: {metodoPago}\n\nProductos:\n{productos}\n\nTOTAL: S/ {total}",
    grupo: "notificaciones",
    label: "Plantilla WhatsApp",
  },
  { clave: "usar_twilio_whatsapp", valor: "false", tipo: "boolean", grupo: "notificaciones", label: "Usar Twilio" },
  { clave: "resend_api_key", valor: "", grupo: "notificaciones", label: "Resend API Key" },
  { clave: "twilio_account_sid", valor: "", grupo: "notificaciones", label: "Twilio Account SID" },
  { clave: "twilio_auth_token", valor: "", grupo: "notificaciones", label: "Twilio Auth Token" },
  { clave: "twilio_whatsapp_number", valor: "", grupo: "notificaciones", label: "Twilio WhatsApp" },
  { clave: "hcaptcha_site_key", valor: "", grupo: "seguridad", label: "hCaptcha Site Key" },
  { clave: "hcaptcha_secret_key", valor: "", grupo: "seguridad", label: "hCaptcha Secret Key" },
  { clave: "login_intentos_maximos", valor: "5", tipo: "number", grupo: "seguridad", label: "Intentos maximos login" },
  { clave: "login_bloqueo_minutos", valor: "15", tipo: "number", grupo: "seguridad", label: "Minutos de bloqueo" },
  { clave: "pdf_pie_pagina", valor: "Este documento es una orden interna de pedido, no tiene validez tributaria.", grupo: "pdf", label: "Pie de pagina PDF" },
  { clave: "texto_recibo", valor: "No es comprobante de pago ni factura electronica. Pedido sujeto a confirmacion.", grupo: "pdf", label: "Texto recibo" },
  { clave: "texto_proforma", valor: "Documento interno para validacion y preparacion del pedido.", grupo: "pdf", label: "Texto proforma" },
  { clave: "mensaje_carrito", valor: "Completa tus datos para coordinar tu pedido. No es una compra confirmada; un asesor revisara disponibilidad y coordinara por WhatsApp.", grupo: "tienda", label: "Mensaje carrito" },
  { clave: "mensaje_checkout", valor: "El pedido sera revisado y coordinado por WhatsApp antes de confirmar disponibilidad y entrega.", grupo: "tienda", label: "Mensaje checkout" },
  { clave: "modo_mantenimiento", valor: "false", tipo: "boolean", grupo: "tienda", label: "Modo mantenimiento" },
  { clave: "social_facebook", valor: "", grupo: "social", label: "Facebook" },
  { clave: "social_instagram", valor: "", grupo: "social", label: "Instagram" },
  { clave: "social_tiktok", valor: "", grupo: "social", label: "TikTok" },
  { clave: "estados_pedido", valor: JSON.stringify(["nuevo", "en_revision", "confirmado", "preparando", "entregado", "cancelado"]), tipo: "json", grupo: "pedidos", label: "Estados de pedido" },
];

async function seedCommercialRules() {
  await prisma.coupon.upsert({
    where: { codigo: "BODEGA10" },
    create: { codigo: "BODEGA10", descripcion: "S/ 10 de descuento desde S/ 100", tipo: "fijo", valor: 10, montoMinimo: 100, limitePorCliente: 99, activo: true, prioridad: 10 },
    update: { activo: true, limitePorCliente: 99 },
  });
  const existing = await prisma.bonus.findFirst({ where: { codigoInterno: "REGALO-MAYORISTA" } });
  if (!existing) await prisma.bonus.create({ data: { nombre: "Regalo mayorista", codigoInterno: "REGALO-MAYORISTA", descripcion: "Bonificacion por pedido mayorista", condicionTipo: "monto", condicionValor: 200, beneficio: "Producto de bonificacion", activo: true } });
}

async function seedMediaAssets() {
  const [products, banners, bonuses] = await Promise.all([
    prisma.product.findMany({ select: { id: true, imagenPrincipal: true } }),
    prisma.banner.findMany({ select: { id: true, imagenDesktop: true, imagenMobile: true } }),
    prisma.bonus.findMany({ select: { id: true, imagen: true } }),
  ]);
  const entries = [
    ...products.map((item) => ({ path: item.imagenPrincipal, type: "product", id: item.id })),
    ...banners.flatMap((item) => [{ path: item.imagenDesktop, type: "banner", id: item.id }, { path: item.imagenMobile, type: "banner", id: item.id }]),
    ...bonuses.map((item) => ({ path: item.imagen, type: "bonus", id: item.id })),
  ].filter((item): item is { path: string; type: string; id: string } => Boolean(item.path?.startsWith("/uploads/")));
  for (const entry of entries) {
    const filePath = path.join(process.cwd(), "public", entry.path.replace(/^\//, ""));
    const stat = await fs.stat(filePath).catch(() => null);
    await prisma.mediaAsset.upsert({
      where: { path: entry.path },
      create: { path: entry.path, originalName: path.basename(entry.path), mimeType: "application/octet-stream", size: stat?.size ?? 0, folder: entry.path.split("/")[2] ?? "uploads", entityType: entry.type, entityId: entry.id },
      update: { size: stat?.size ?? 0, entityType: entry.type, entityId: entry.id },
    });
  }
}

async function main() {
  if (!adminSeedPassword) {
    throw new Error("Define ADMIN_SEED_PASSWORD en .env antes de ejecutar el seed.");
  }

  const existingProducts = await prisma.product.count();
  if (existingProducts > 0) {
    await Promise.all(
      settings.map((setting) =>
        prisma.setting.upsert({
          where: { clave: setting.clave },
          create: setting,
          update: ["telefono", "whatsapp"].includes(setting.clave) ? { valor: setting.valor } : {},
        }),
      ),
    );
    await prisma.adminUser.upsert({
      where: { email: "admin@globalnorte.pe" },
      create: {
        nombre: "Administrador Global Norte",
        email: "admin@globalnorte.pe",
        password: await bcrypt.hash(adminSeedPassword, 12),
        rol: "superadmin",
      },
      update: { activo: true, rol: "superadmin" },
    });
    const bannerCount = await prisma.banner.count();
    if (bannerCount === 0) {
      await prisma.banner.createMany({
        data: [
          {
            titulo: "Ahorro mayorista para tu negocio",
            subtitulo: "409 productos para bodegas, tiendas y negocios",
            descripcion: "Pedido online y entrega coordinada con Global Norte.",
            ctaTexto: "Ver catalogo",
            ctaLink: "/catalogo",
            imagenDesktop: "/brand/global-norte-logo.jpg",
            imagenMobile: "/brand/global-norte-logo.jpg",
            posicion: "hero",
            colorTexto: "dark",
            orden: 1,
          },
        ],
      });
    }
    await seedCommercialRules();
    await seedMediaAssets();
    process.stdout.write(`Seed seguro: se conservaron ${existingProducts} productos existentes.\n`);
    return;
  }

  await prisma.couponUsage.deleteMany();
  await prisma.customerBenefit.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.bonus.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.orderHistory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.address.deleteMany();
  await prisma.product.deleteMany();
  await prisma.banner.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.category.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.activityLog.deleteMany();

  const categoryRecords = await Promise.all(
    inventory.categories.map((category, index) =>
      prisma.category.create({
        data: {
          nombre: category.nombre,
          slug: category.slug,
          descripcion: `Productos de ${category.nombre.toLowerCase()} para venta mayorista.`,
          icono: category.icono,
          orden: index + 1,
        },
      }),
    ),
  );
  const categoryBySlug = new Map(categoryRecords.map((category) => [category.slug, category.id]));

  const brandRecords = await Promise.all(
    inventory.brands.map((brand, index) =>
      prisma.brand.create({
        data: {
          nombre: brand.nombre,
          slug: brand.slug,
          destacada: Boolean(brand.destacada),
          descripcion: `Marca ${brand.nombre} disponible en Global Norte.`,
          orden: index + 1,
        },
      }),
    ),
  );
  const brandBySlug = new Map(brandRecords.map((brand) => [brand.slug, brand.id]));

  await prisma.product.createMany({
    data: inventory.products.map((product) => {
      return {
        codigoInterno: product.codigoInterno,
        nombre: product.nombre,
        slug: product.slug,
        descripcion: product.descripcion,
        categoryId: categoryBySlug.get(product.categorySlug) ?? categoryRecords[0].id,
        brandId: product.brandSlug ? brandBySlug.get(product.brandSlug) ?? null : null,
        precioUnitario: product.precioUnitario,
        precioCaja: product.precioCaja,
        unidadesPorCaja: product.unidadesPorCaja,
        etiquetaCaja: product.etiquetaCaja,
        precioAnterior: product.precioAnterior,
        stock: product.stock,
        stockMinimo: product.stockMinimo,
        unidad: product.unidad,
        imagenes: "[]",
        imagenPrincipal: null,
        destacado: product.destacado,
        enOferta: product.enOferta,
        nuevo: product.nuevo,
        agotado: product.agotado,
        tags: JSON.stringify(product.tags),
        seoTitulo: product.seoTitulo,
        seoDesc: product.seoDesc,
      };
    }),
  });

  await prisma.banner.createMany({
    data: [
      {
        titulo: "Precios mayoristas para tu negocio",
        subtitulo: "Global Norte Distribuidora",
        descripcion: "Abarrotes, limpieza e higiene con despacho a bodegas y tiendas.",
        ctaTexto: "Ver catalogo",
        ctaLink: "/catalogo",
        imagenDesktop: "/brand/global-norte-logo.jpg",
        imagenMobile: "/brand/global-norte-logo.jpg",
        posicion: "hero",
        colorTexto: "dark",
        orden: 1,
      },
      {
        titulo: "Reposicion rapida",
        subtitulo: "Pedidos online y cobro contra entrega",
        descripcion: "Arma tu pedido, confirma y recibe el PDF automatico.",
        ctaTexto: "Comprar ahora",
        ctaLink: "/catalogo?disponible=1",
        imagenDesktop: "/brand/global-norte-logo.jpg",
        posicion: "mid",
        colorTexto: "dark",
        orden: 2,
      },
    ],
  });

  await prisma.setting.createMany({ data: settings });

  await prisma.adminUser.create({
    data: {
      nombre: "Administrador Global Norte",
      email: "admin@globalnorte.pe",
      password: await bcrypt.hash(adminSeedPassword, 12),
      rol: "superadmin",
    },
  });
  await seedCommercialRules();
  await seedMediaAssets();

  await prisma.activityLog.create({
    data: {
      accion: "seed",
      modulo: "sistema",
      detalle: `Seed completado con ${inventory.products.length} productos reales del inventario.`,
    },
  });

  process.stdout.write(`Seed completado: ${inventory.products.length} productos, ${inventory.categories.length} categorias.\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
