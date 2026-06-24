import { prisma } from "@/lib/db";

export type CommerceLine = {
  productId: string;
  categoryId: string;
  brandId: string | null;
  cantidad: number;
  subtotal: number;
};

export type BonusLine = {
  source: "coupon" | "bonus" | "customer";
  code?: string;
  name: string;
  description?: string;
  quantity: number;
  price: 0;
};

function stringList(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function activeAt(start: Date | null, end: Date | null, now = new Date()) {
  return (!start || start <= now) && (!end || end >= now);
}

function applicableSubtotal(
  lines: CommerceLine[],
  categoryIds: string[],
  brandIds: string[],
  excludedProductIds: string[],
) {
  return lines.reduce((sum, line) => {
    if (excludedProductIds.includes(line.productId)) return sum;
    if (categoryIds.length && !categoryIds.includes(line.categoryId)) return sum;
    if (brandIds.length && (!line.brandId || !brandIds.includes(line.brandId))) return sum;
    return sum + line.subtotal;
  }, 0);
}

export async function evaluateCommerce(input: {
  userId: string;
  couponCode?: string | null;
  lines: CommerceLine[];
}) {
  const subtotal = input.lines.reduce((sum, line) => sum + line.subtotal, 0);
  const totalUnits = input.lines.reduce((sum, line) => sum + line.cantidad, 0);
  const now = new Date();
  const bonuses: BonusLine[] = [];
  let discount = 0;
  let coupon: null | { id: string; code: string; description: string; type: string } = null;

  const benefit = await prisma.customerBenefit.findUnique({ where: { userId: input.userId } });
  const requestedCode = (input.couponCode || (benefit?.aplicarAutomatico ? benefit.cuponExclusivo : "") || "").trim().toUpperCase();

  if (requestedCode) {
    const found = await prisma.coupon.findUnique({ where: { codigo: requestedCode } });
    if (!found || !found.activo || !activeAt(found.fechaInicio, found.fechaFin, now)) {
      throw new Error("El cupon no existe, esta inactivo o esta fuera de fecha");
    }
    if (found.cantidadMaximaUsos !== null && found.cantidadUsos >= found.cantidadMaximaUsos) {
      throw new Error("El cupon alcanzo su limite de usos");
    }
    const userUses = await prisma.couponUsage.count({ where: { couponId: found.id, userId: input.userId } });
    if ((found.usoUnico && userUses > 0) || userUses >= found.limitePorCliente) {
      throw new Error("Ya utilizaste el maximo permitido para este cupon");
    }
    if (subtotal < found.montoMinimo) {
      throw new Error(`El cupon requiere un pedido minimo de S/ ${found.montoMinimo.toFixed(2)}`);
    }
    const eligible = applicableSubtotal(
      input.lines,
      stringList(found.categoriasAplicables),
      stringList(found.marcasAplicables),
      stringList(found.productosExcluidos),
    );
    if (eligible <= 0) throw new Error("El cupon no aplica a los productos del pedido");

    if (found.tipo === "fijo") discount += Math.min(found.valor, eligible);
    if (found.tipo === "porcentaje") discount += Math.min(eligible, eligible * Math.min(100, found.valor) / 100);
    if (found.tipo === "regalo") {
      bonuses.push({ source: "coupon", code: found.codigo, name: found.regaloNombre || found.descripcion || "Producto de bonificacion", quantity: 1, price: 0 });
    }
    if (found.tipo === "beneficio") {
      bonuses.push({ source: "coupon", code: found.codigo, name: found.regaloNombre || found.descripcion || "Beneficio de entrega", quantity: 1, price: 0 });
    }
    coupon = { id: found.id, code: found.codigo, description: found.descripcion || found.codigo, type: found.tipo };
  }

  const availableBonuses = await prisma.bonus.findMany({
    where: {
      activo: true,
      OR: [{ clienteId: null }, { clienteId: input.userId }],
    },
    orderBy: { createdAt: "asc" },
  });
  for (const item of availableBonuses) {
    if (!activeAt(item.fechaInicio, item.fechaFin, now)) continue;
    let applies = false;
    if (item.condicionTipo === "monto") applies = subtotal >= item.condicionValor;
    if (item.condicionTipo === "cantidad") applies = totalUnits >= item.condicionValor;
    if (item.condicionTipo === "categoria") applies = input.lines.some((line) => line.categoryId === item.categoryId && line.cantidad >= Math.max(1, item.condicionValor));
    if (item.condicionTipo === "marca") applies = input.lines.some((line) => line.brandId === item.brandId && line.cantidad >= Math.max(1, item.condicionValor));
    if (item.condicionTipo === "cliente") applies = item.clienteId === input.userId;
    if (item.condicionTipo === "fecha") applies = true;
    if (applies) bonuses.push({ source: "bonus", code: item.codigoInterno || undefined, name: item.nombre, description: item.beneficio, quantity: 1, price: 0 });
  }

  if (benefit?.activo) {
    if (benefit.aplicarAutomatico && benefit.descuentoEspecial > 0) {
      discount += subtotal * Math.min(100, benefit.descuentoEspecial) / 100;
    }
    if (benefit.productoGratis) bonuses.push({ source: "customer", name: benefit.productoGratis, description: "Beneficio exclusivo del cliente", quantity: 1, price: 0 });
    if (benefit.bonificacionEspecial) bonuses.push({ source: "customer", name: benefit.bonificacionEspecial, description: "Bonificacion especial", quantity: 1, price: 0 });
  }

  discount = Math.min(subtotal, Math.round(discount * 100) / 100);
  return {
    subtotal,
    discount,
    total: Math.max(0, Math.round((subtotal - discount) * 100) / 100),
    coupon,
    bonuses,
    customerBenefit: benefit
      ? {
          couponCode: benefit.cuponExclusivo,
          message: benefit.bonificacionEspecial || benefit.productoGratis || (benefit.descuentoEspecial > 0 ? `Descuento especial de ${benefit.descuentoEspecial}%` : null),
        }
      : null,
  };
}

