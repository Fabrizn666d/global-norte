import { prisma } from "@/lib/db";

const marker = process.env.QA_RUN_ID ? `TEST QA ${process.env.QA_RUN_ID}` : "TEST QA";
const codePrefix = process.env.QA_RUN_ID ? `TESTQA${process.env.QA_RUN_ID}` : "TESTQA";

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { numero: { startsWith: codePrefix } },
        { clienteNegocio: { contains: marker } },
        { notasCliente: { contains: marker } },
        { notasInternas: { contains: marker } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  await prisma.$transaction([
    prisma.couponUsage.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.orderHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
    prisma.notification.deleteMany({ where: { titulo: { contains: marker } } }),
    prisma.banner.deleteMany({ where: { titulo: { contains: marker } } }),
    prisma.bonus.deleteMany({ where: { OR: [{ nombre: { contains: marker } }, { codigoInterno: { startsWith: codePrefix } }] } }),
    prisma.coupon.deleteMany({ where: { codigo: { startsWith: codePrefix } } }),
    prisma.customerBenefit.deleteMany({ where: { user: { email: { contains: codePrefix.toLowerCase() } } } }),
    prisma.user.deleteMany({ where: { email: { contains: codePrefix.toLowerCase() } } }),
    prisma.product.deleteMany({ where: { codigoInterno: { startsWith: codePrefix } } }),
    prisma.category.deleteMany({ where: { nombre: { contains: marker } } }),
    prisma.brand.deleteMany({ where: { nombre: { contains: marker } } }),
    prisma.activityLog.deleteMany({ where: { modulo: "qa", detalle: { contains: marker } } }),
  ]);
  console.log(`[qa:clean] Eliminados datos marcados con ${marker}`);
}

main()
  .catch((error) => {
    console.error("[qa:clean] Error", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
