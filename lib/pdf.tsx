import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";
import { COMPANY } from "@/lib/company";
import { prisma } from "@/lib/db";
import { money } from "@/lib/format";

type CompanyInfo = { name: string; legalName: string; ruc: string; whatsappDisplay: string; whatsappNumber: string; email: string; address: string };

type PdfOrder = {
  numero: string;
  clienteNombre: string;
  clienteApellido: string;
  clienteEmail: string;
  clienteTelefono: string;
  clienteDni?: string | null;
  clienteRuc?: string | null;
  clienteNegocio: string | null;
  entregaDireccion: string;
  entregaDistrito: string;
  entregaProvincia: string;
  entregaDepartamento: string;
  entregaReferencia?: string | null;
  entregaMapsUrl?: string | null;
  metodoEntrega?: string | null;
  estado: string;
  metodoPago: string;
  subtotal: number;
  descuento: number;
  cuponCodigo?: string | null;
  cuponDescripcion?: string | null;
  bonificaciones?: string | null;
  total: number;
  notasCliente?: string | null;
  notasInternas?: string | null;
  createdAt: Date;
  items: Array<{
    codigoInterno: string;
    nombre: string;
    marca?: string | null;
    tipoPrecio: string;
    etiqueta?: string | null;
    cantidad: number;
    precio: number;
    subtotal: number;
  }>;
};

const red = "#D71920";
const dark = "#171717";
const gray = "#5F6368";
const line = "#E5E7EB";

const styles = StyleSheet.create({
  page: { padding: 26, fontSize: 9, color: dark, fontFamily: "Helvetica", backgroundColor: "#FFFFFF" },
  topBar: { height: 10, backgroundColor: red, margin: -26, marginBottom: 18 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "stretch", marginBottom: 14 },
  brandBlock: { flexDirection: "row", alignItems: "center", width: "58%" },
  logoWrap: { width: 74, height: 74, border: `1 solid ${line}`, borderRadius: 8, padding: 5, marginRight: 12 },
  logo: { width: "100%", height: "100%", objectFit: "contain" },
  brandName: { fontSize: 18, color: red, fontWeight: 700, marginBottom: 3 },
  companyLine: { fontSize: 8.5, color: gray, marginTop: 2 },
  docBox: { width: "34%", border: `1.4 solid ${red}`, borderRadius: 8, overflow: "hidden" },
  docTitle: { backgroundColor: red, color: "#FFFFFF", textAlign: "center", padding: 8, fontSize: 12, fontWeight: 700 },
  docBody: { padding: 9 },
  docNumber: { fontSize: 13, fontWeight: 700, color: dark, textAlign: "center", marginBottom: 6 },
  badge: { alignSelf: "center", borderRadius: 10, backgroundColor: "#FFF1F2", color: red, paddingHorizontal: 8, paddingVertical: 3, fontSize: 8, fontWeight: 700 },
  sectionGrid: { flexDirection: "row", marginBottom: 10 },
  sectionGap: { width: 10 },
  box: { flex: 1, border: `1 solid ${line}`, borderRadius: 8, padding: 10, backgroundColor: "#FAFAFA" },
  boxWhite: { flex: 1, border: `1 solid ${line}`, borderRadius: 8, padding: 10, backgroundColor: "#FFFFFF" },
  boxTitle: { fontSize: 8, color: red, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 78, color: gray, fontSize: 8.5 },
  value: { flex: 1, color: dark, fontSize: 8.5, fontWeight: 700 },
  table: { border: `1 solid ${line}`, borderRadius: 8, overflow: "hidden", marginTop: 8 },
  tableHeader: { flexDirection: "row", backgroundColor: red, color: "#FFFFFF", paddingVertical: 7, paddingHorizontal: 6, fontSize: 8, fontWeight: 700 },
  tableHeaderAdmin: { flexDirection: "row", backgroundColor: dark, color: "#FFFFFF", paddingVertical: 7, paddingHorizontal: 6, fontSize: 8, fontWeight: 700 },
  tableRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottom: `1 solid ${line}`, fontSize: 8 },
  tableRowAlt: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottom: `1 solid ${line}`, backgroundColor: "#FAFAFA", fontSize: 8 },
  codeCol: { width: "13%" },
  productCol: { width: "29%" },
  brandCol: { width: "13%" },
  unitCol: { width: "7%" },
  qtyCol: { width: "9%", textAlign: "right" },
  priceCol: { width: "14%", textAlign: "right" },
  subtotalCol: { width: "15%", textAlign: "right" },
  productText: { fontWeight: 700 },
  totalsWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 12 },
  noteBox: { width: "58%", border: `1 solid ${line}`, borderRadius: 8, padding: 10, backgroundColor: "#FFFDF7" },
  noteTitle: { fontSize: 8, fontWeight: 700, color: dark, marginBottom: 4 },
  noteText: { fontSize: 8.5, color: gray, lineHeight: 1.4 },
  totals: { width: "34%", border: `1 solid ${line}`, borderRadius: 8, overflow: "hidden" },
  totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 10, borderBottom: `1 solid ${line}`, fontSize: 9 },
  grandTotal: { flexDirection: "row", justifyContent: "space-between", backgroundColor: red, color: "#FFFFFF", paddingVertical: 9, paddingHorizontal: 10, fontSize: 13, fontWeight: 700 },
  signatureRow: { flexDirection: "row", marginTop: 18 },
  signature: { width: 190, borderTop: "1 solid #9CA3AF", paddingTop: 6, textAlign: "center", color: gray, fontSize: 8 },
  footer: { position: "absolute", bottom: 16, left: 26, right: 26, borderTop: `1 solid ${line}`, paddingTop: 8, color: gray, fontSize: 8, textAlign: "center" },
});

async function logoSource() {
  const file = await fs.readFile(path.join(process.cwd(), "public", "brand", "global-norte-logo.jpg"));
  const png = await sharp(file).resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function companyInfo(): Promise<CompanyInfo> {
  const rows = await prisma.setting.findMany({
    where: { clave: { in: ["nombre_empresa", "ruc", "telefono", "whatsapp", "email", "direccion"] } },
  });
  const settings = new Map(rows.map((row) => [row.clave, row.valor]));
  return {
    ...COMPANY,
    name: settings.get("nombre_empresa") ?? COMPANY.name,
    legalName: settings.get("nombre_empresa") ?? COMPANY.legalName,
    ruc: settings.get("ruc") ?? COMPANY.ruc,
    whatsappDisplay: settings.get("telefono") ?? COMPANY.whatsappDisplay,
    whatsappNumber: settings.get("whatsapp") ?? COMPANY.whatsappNumber,
    email: settings.get("email") ?? COMPANY.email,
    address: settings.get("direccion") ?? COMPANY.address,
  };
}

function clean(value?: string | null) {
  return value?.trim() || "-";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{clean(value)}</Text>
    </View>
  );
}

function Header({ order, title, logoSrc, company, admin = false }: { order: PdfOrder; title: string; logoSrc: string; company: CompanyInfo; admin?: boolean }) {
  return (
    <>
      <View style={styles.topBar} />
      <View style={styles.header}>
        <View style={styles.brandBlock}>
          <View style={styles.logoWrap}>
            <Image src={logoSrc} style={styles.logo} />
          </View>
          <View>
            <Text style={styles.brandName}>{company.name}</Text>
            <Text style={styles.companyLine}>RUC {company.ruc}</Text>
            <Text style={styles.companyLine}>WhatsApp {company.whatsappDisplay} | {company.email}</Text>
            <Text style={styles.companyLine}>{company.address}</Text>
          </View>
        </View>
        <View style={styles.docBox}>
          <Text style={styles.docTitle}>{title}</Text>
          <View style={styles.docBody}>
            <Text style={styles.docNumber}>{order.numero}</Text>
            <Text style={styles.companyLine}>Fecha: {formatDate(order.createdAt)}</Text>
            <Text style={styles.companyLine}>Estado: {order.estado}</Text>
            {admin ? <Text style={styles.badge}>USO INTERNO</Text> : null}
          </View>
        </View>
      </View>
    </>
  );
}

function CustomerAndDelivery({ order, admin = false }: { order: PdfOrder; admin?: boolean }) {
  return (
    <View style={styles.sectionGrid}>
      <View style={admin ? styles.boxWhite : styles.box}>
        <Text style={styles.boxTitle}>Datos del cliente</Text>
        <InfoRow label="Negocio:" value={order.clienteNegocio} />
        <InfoRow label="Contacto:" value={`${order.clienteNombre} ${order.clienteApellido}`} />
        <InfoRow label="Telefono:" value={order.clienteTelefono} />
        <InfoRow label="Email:" value={order.clienteEmail} />
        <InfoRow label="RUC/DNI:" value={order.clienteRuc ?? order.clienteDni} />
      </View>
      <View style={styles.sectionGap} />
      <View style={admin ? styles.boxWhite : styles.box}>
        <Text style={styles.boxTitle}>Entrega y pago</Text>
        <InfoRow label="Direccion:" value={order.entregaDireccion} />
        <InfoRow label="Distrito:" value={order.entregaDistrito} />
        <InfoRow label="Provincia:" value={`${order.entregaProvincia}, ${order.entregaDepartamento}`} />
        <InfoRow label="Referencia:" value={order.entregaReferencia} />
        <InfoRow label="Google Maps:" value={order.entregaMapsUrl} />
        <InfoRow label="Entrega:" value={order.metodoEntrega} />
        <InfoRow label="Pago:" value={order.metodoPago} />
      </View>
    </View>
  );
}

function ItemsTable({ order, admin = false }: { order: PdfOrder; admin?: boolean }) {
  return (
    <View style={styles.table}>
      <View style={admin ? styles.tableHeaderAdmin : styles.tableHeader}>
        <Text style={styles.codeCol}>Codigo</Text>
        <Text style={styles.productCol}>Producto</Text>
        <Text style={styles.brandCol}>Marca</Text>
        <Text style={styles.unitCol}>Unidad</Text>
        <Text style={styles.qtyCol}>Cant.</Text>
        <Text style={styles.priceCol}>P. Unit.</Text>
        <Text style={styles.subtotalCol}>Subtotal</Text>
      </View>
      {order.items.map((item, index) => (
        <View style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt} key={`${item.codigoInterno}-${item.nombre}-${index}`}>
          <Text style={styles.codeCol}>{item.codigoInterno}</Text>
          <Text style={[styles.productCol, styles.productText]}>{item.nombre}</Text>
          <Text style={styles.brandCol}>{clean(item.marca)}</Text>
          <Text style={styles.unitCol}>{item.etiqueta || item.tipoPrecio}</Text>
          <Text style={styles.qtyCol}>{item.cantidad}</Text>
          <Text style={styles.priceCol}>{money(item.precio)}</Text>
          <Text style={styles.subtotalCol}>{money(item.subtotal)}</Text>
        </View>
      ))}
    </View>
  );
}

function TotalsAndMessage({ order, admin = false }: { order: PdfOrder; admin?: boolean }) {
  let bonuses: Array<{ name?: string; description?: string; quantity?: number }> = [];
  try { bonuses = JSON.parse(order.bonificaciones || "[]"); } catch { bonuses = []; }
  return (
    <View style={styles.totalsWrap}>
      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>{admin ? "Observaciones internas" : "Mensaje"}</Text>
        <Text style={styles.noteText}>
          {admin
            ? `Gracias por su pedido. Nos comunicaremos para coordinar la entrega. Cliente: ${clean(order.notasCliente)} | Interno: ${clean(order.notasInternas)}`
            : "Gracias por su pedido. Nos comunicaremos para coordinar la entrega."}
        </Text>
        {order.cuponCodigo ? <Text style={styles.noteText}>Cupon: {order.cuponCodigo} - {clean(order.cuponDescripcion)}</Text> : null}
        {bonuses.map((bonus, index) => <Text key={`${bonus.name}-${index}`} style={styles.noteText}>Bonificacion / regalo: {bonus.quantity || 1} x {bonus.name} - {bonus.description || "Sin costo"} (S/ 0.00)</Text>)}
        {!admin ? <Text style={styles.noteText}>No es comprobante de pago ni factura electronica. Pedido sujeto a confirmacion.</Text> : null}
      </View>
      <View style={styles.totals}>
        <View style={styles.totalLine}><Text>Subtotal</Text><Text>{money(order.subtotal)}</Text></View>
        <View style={styles.totalLine}><Text>Descuento</Text><Text>{money(order.descuento)}</Text></View>
        <View style={styles.grandTotal}><Text>TOTAL</Text><Text>{money(order.total)}</Text></View>
      </View>
    </View>
  );
}

function Footer({ company }: { company: CompanyInfo }) {
  return (
    <Text style={styles.footer}>
      {company.name} | RUC {company.ruc} | WhatsApp {company.whatsappDisplay} | {company.email} | {company.address}
    </Text>
  );
}

function ClientReceipt({ order, logoSrc, company }: { order: PdfOrder; logoSrc: string; company: CompanyInfo }) {
  return (
    <Document title={`Recibo de pedido ${order.numero}`} author={company.name}>
      <Page size="A4" style={styles.page}>
        <Header order={order} title="RECIBO DE PEDIDO" logoSrc={logoSrc} company={company} />
        <CustomerAndDelivery order={order} />
        <ItemsTable order={order} />
        <TotalsAndMessage order={order} />
        <Footer company={company} />
      </Page>
    </Document>
  );
}

function AdminProforma({ order, logoSrc, company }: { order: PdfOrder; logoSrc: string; company: CompanyInfo }) {
  return (
    <Document title={`Proforma ${order.numero}`} author={company.name}>
      <Page size="A4" style={styles.page}>
        <Header order={order} title="PROFORMA INTERNA / PEDIDO" logoSrc={logoSrc} company={company} admin />
        <View style={styles.box}>
          <Text style={styles.boxTitle}>{company.legalName}</Text>
          <Text style={styles.companyLine}>Pedido para preparacion. Documento interno para validar stock, precios, estado y entrega.</Text>
        </View>
        <CustomerAndDelivery order={order} admin />
        <ItemsTable order={order} admin />
        <TotalsAndMessage order={order} admin />
        <View style={styles.signatureRow}>
          <View style={styles.signature}><Text>Validacion de stock</Text></View>
          <View style={styles.sectionGap} />
          <View style={styles.signature}><Text>Confirmacion de entrega</Text></View>
        </View>
        <Footer company={company} />
      </Page>
    </Document>
  );
}

async function writePdf(fileName: string, document: React.ReactElement) {
  const pdfDir = path.resolve(process.env.PDF_DIR ?? "./public/pdfs");
  await fs.mkdir(pdfDir, { recursive: true });
  const fullPath = path.join(pdfDir, fileName);
  const buffer = await renderToBuffer(document);
  await fs.writeFile(fullPath, buffer);
  return `/pdfs/${fileName}`;
}

export async function createOrderPdf(order: PdfOrder) {
  return writePdf(`${order.numero}-recibo-global-norte.pdf`, <ClientReceipt order={order} logoSrc={await logoSource()} company={await companyInfo()} />);
}

export async function createAdminOrderPdf(order: PdfOrder) {
  return writePdf(`${order.numero}-proforma-admin-global-norte.pdf`, <AdminProforma order={order} logoSrc={await logoSource()} company={await companyInfo()} />);
}
