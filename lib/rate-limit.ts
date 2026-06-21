import { prisma } from "@/lib/db";

export async function checkRateLimit(
  ip: string,
  accion: string,
  limit: number,
  windowMs: number,
  blockMs = windowMs,
) {
  const now = new Date();
  const record = await prisma.rateLimit.findUnique({
    where: { ip_accion: { ip, accion } },
  });

  if (!record) {
    await prisma.rateLimit.create({ data: { ip, accion, intentos: 1 } });
    return { ok: true, remaining: limit - 1 };
  }

  if (record.bloqueadoHasta && record.bloqueadoHasta > now) {
    return { ok: false, retryAt: record.bloqueadoHasta };
  }

  const outsideWindow = now.getTime() - record.updatedAt.getTime() > windowMs;
  const attempts = outsideWindow ? 1 : record.intentos + 1;
  const bloqueadoHasta = attempts > limit ? new Date(now.getTime() + blockMs) : null;

  await prisma.rateLimit.update({
    where: { ip_accion: { ip, accion } },
    data: {
      intentos: bloqueadoHasta ? attempts : attempts,
      bloqueadoHasta,
    },
  });

  if (bloqueadoHasta) {
    return { ok: false, retryAt: bloqueadoHasta };
  }

  return { ok: true, remaining: Math.max(0, limit - attempts) };
}
