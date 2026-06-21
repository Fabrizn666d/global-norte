import { prisma } from "@/lib/db";

export async function nextOrderNumber() {
  const year = new Date().getFullYear();
  const latest = await prisma.order.findFirst({
    where: {
      numero: { startsWith: `GN-${year}-` },
    },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const lastSequence = Number(latest?.numero.split("-").at(-1) ?? 0);
  return `GN-${year}-${String(lastSequence + 1).padStart(5, "0")}`;
}

export function linePrice(item: { tipoPrecio: string; product: { precioUnitario: number; precioCaja: number | null } }) {
  return item.tipoPrecio === "caja" && item.product.precioCaja ? item.product.precioCaja : item.product.precioUnitario;
}
