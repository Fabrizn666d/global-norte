import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { money } from "@/lib/format";

export type ConsolidatedRow = {
  codigo: string;
  producto: string;
  categoria: string;
  marca: string;
  unidad: string;
  cantidad: number;
  precioReferencial: number;
  subtotal: number;
  pedidos: number;
  observacion: string;
};

const styles = StyleSheet.create({
  page: { padding: 24, fontFamily: "Helvetica", fontSize: 7.5, color: "#171717" },
  header: { backgroundColor: "#D71920", color: "#FFFFFF", margin: -24, marginBottom: 18, padding: 20 },
  title: { fontSize: 18, fontWeight: 700 },
  subtitle: { marginTop: 4, fontSize: 9 },
  summary: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10, padding: 8, backgroundColor: "#F5F5F5" },
  table: { border: "1 solid #D1D5DB" },
  row: { flexDirection: "row", padding: 5, borderBottom: "1 solid #E5E7EB" },
  head: { flexDirection: "row", padding: 6, backgroundColor: "#171717", color: "#FFFFFF", fontWeight: 700 },
  code: { width: "10%" },
  product: { width: "28%" },
  category: { width: "12%" },
  brand: { width: "11%" },
  unit: { width: "8%" },
  qty: { width: "8%", textAlign: "right" },
  orders: { width: "7%", textAlign: "right" },
  subtotal: { width: "10%", textAlign: "right" },
  note: { width: "6%", textAlign: "right", color: "#D71920" },
  footer: { position: "absolute", left: 24, right: 24, bottom: 14, borderTop: "1 solid #E5E7EB", paddingTop: 6, color: "#6B7280", textAlign: "center" },
});

export async function createConsolidatedPdf(input: { rows: ConsolidatedRow[]; from: string; to: string; orderCount: number; total: number }) {
  const document = (
    <Document title="Consolidado de carga Global Norte">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>GLOBAL NORTE | CONSOLIDADO DE CARGA</Text>
          <Text style={styles.subtitle}>{input.from} a {input.to} | Generado {new Date().toLocaleString("es-PE")}</Text>
        </View>
        <View style={styles.summary}>
          <Text>{input.orderCount} pedidos</Text>
          <Text>{input.rows.length} productos agrupados</Text>
          <Text>Total referencial {money(input.total)}</Text>
        </View>
        <View style={styles.table}>
          <View style={styles.head}>
            <Text style={styles.code}>Codigo</Text><Text style={styles.product}>Producto</Text><Text style={styles.category}>Categoria</Text><Text style={styles.brand}>Marca</Text><Text style={styles.unit}>Unidad</Text><Text style={styles.qty}>Cantidad</Text><Text style={styles.orders}>Pedidos</Text><Text style={styles.subtotal}>Subtotal</Text><Text style={styles.note}>Stock</Text>
          </View>
          {input.rows.map((row) => (
            <View key={row.codigo} style={styles.row} wrap={false}>
              <Text style={styles.code}>{row.codigo}</Text><Text style={styles.product}>{row.producto}</Text><Text style={styles.category}>{row.categoria}</Text><Text style={styles.brand}>{row.marca}</Text><Text style={styles.unit}>{row.unidad}</Text><Text style={styles.qty}>{row.cantidad}</Text><Text style={styles.orders}>{row.pedidos}</Text><Text style={styles.subtotal}>{money(row.subtotal)}</Text><Text style={styles.note}>{row.observacion || "OK"}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.footer}>{COMPANY.legalName} | RUC {COMPANY.ruc} | WhatsApp {COMPANY.whatsappDisplay}</Text>
      </Page>
    </Document>
  );
  return renderToBuffer(document);
}

