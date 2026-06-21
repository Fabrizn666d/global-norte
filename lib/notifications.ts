import fs from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import twilio from "twilio";
import { normalizePhone } from "@/lib/format";

type NotificationOrder = {
  numero: string;
  clienteNombre: string;
  clienteApellido: string;
  clienteEmail: string;
  clienteTelefono: string;
  entregaDireccion: string;
  metodoPago: string;
  total: number;
  items: Array<{ nombre: string; cantidad: number; subtotal: number }>;
};

function orderHtml(order: NotificationOrder, title: string) {
  const lines = order.items
    .map((item) => `<li>${item.cantidad} x ${item.nombre} - S/ ${item.subtotal.toFixed(2)}</li>`)
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#212121">
      <h1 style="color:#D32F2F">${title}</h1>
      <p><strong>Pedido:</strong> ${order.numero}</p>
      <p><strong>Cliente:</strong> ${order.clienteNombre} ${order.clienteApellido}</p>
      <p><strong>Telefono:</strong> ${order.clienteTelefono}</p>
      <p><strong>Entrega:</strong> ${order.entregaDireccion}</p>
      <ul>${lines}</ul>
      <h2 style="color:#D32F2F">Total: S/ ${order.total.toFixed(2)}</h2>
    </div>
  `;
}

export async function sendOrderEmails(order: NotificationOrder) {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "pedidos@globalnorte.pe";
  const admin = process.env.EMAIL_ADMIN ?? "admin@globalnorte.pe";
  const clientHtml = orderHtml(order, "Pedido recibido en Global Norte");
  const adminHtml = orderHtml(order, "Nuevo pedido para atender");

  if (resendKey) {
    const resend = new Resend(resendKey);
    await Promise.all([
      resend.emails.send({ from, to: order.clienteEmail, subject: `Pedido ${order.numero} recibido`, html: clientHtml }),
      resend.emails.send({ from, to: admin, subject: `Nuevo pedido ${order.numero}`, html: adminHtml }),
    ]);
    return { sent: true, savedToOutbox: false };
  }

  const outbox = path.join(process.cwd(), "public", "outbox");
  await fs.mkdir(outbox, { recursive: true });
  await fs.writeFile(path.join(outbox, `${order.numero}-cliente.html`), clientHtml);
  await fs.writeFile(path.join(outbox, `${order.numero}-admin.html`), adminHtml);
  return { sent: false, savedToOutbox: true };
}

export function buildWhatsAppMessage(order: NotificationOrder, template?: string) {
  const products = order.items
    .map((item) => `- ${item.cantidad} x ${item.nombre}: S/ ${item.subtotal.toFixed(2)}`)
    .join("\n");
  const base =
    template ??
    "*NUEVO PEDIDO #{numero}*\n{fecha}\n\nCliente: {nombre}\nTelefono: {telefono}\nDireccion: {direccion}\nPago: {metodoPago}\n\nProductos:\n{productos}\n\nTOTAL: S/ {total}";
  return base
    .replaceAll("{numero}", order.numero)
    .replaceAll("#{numero}", `#${order.numero}`)
    .replaceAll("{fecha}", new Date().toLocaleString("es-PE"))
    .replaceAll("{nombre}", `${order.clienteNombre} ${order.clienteApellido}`)
    .replaceAll("{telefono}", order.clienteTelefono)
    .replaceAll("{direccion}", order.entregaDireccion)
    .replaceAll("{metodoPago}", order.metodoPago)
    .replaceAll("{productos}", products)
    .replaceAll("{total}", order.total.toFixed(2));
}

export async function sendOrderWhatsApp(order: NotificationOrder, adminPhone: string, template?: string) {
  const message = buildWhatsAppMessage(order, template);
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_NUMBER;

  if (accountSid && authToken && from) {
    const client = twilio(accountSid, authToken);
    await client.messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:+${normalizePhone(adminPhone)}`,
      body: message,
    });
    return { sent: true, link: null };
  }

  return {
    sent: false,
    link: `https://wa.me/${normalizePhone(adminPhone)}?text=${encodeURIComponent(message)}`,
  };
}
