import fs from "node:fs/promises";
import path from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import slugify from "slugify";

const pdfPath =
  process.argv[2] ??
  "C:/Users/FAbri/Downloads/INVENTORY_ReporteInv_20240805080918-1.pdf";
const outPath = path.join(process.cwd(), "prisma", "inventory.json");

const categories = [
  { nombre: "Aceites y Grasas", slug: "aceites-grasas", icono: "Droplet" },
  { nombre: "Arroz y Cereales", slug: "arroz-cereales", icono: "Wheat" },
  { nombre: "Azucar y Endulzantes", slug: "azucar-endulzantes", icono: "Package" },
  { nombre: "Fideos y Pastas", slug: "fideos-pastas", icono: "Soup" },
  { nombre: "Leche y Lacteos", slug: "leche-lacteos", icono: "Milk" },
  { nombre: "Conservas y Enlatados", slug: "conservas-enlatados", icono: "Archive" },
  { nombre: "Condimentos y Sazonadores", slug: "condimentos", icono: "Utensils" },
  { nombre: "Detergentes y Limpieza", slug: "detergentes-limpieza", icono: "Sparkles" },
  { nombre: "Higiene Personal", slug: "higiene-personal", icono: "Heart" },
  { nombre: "Papel e Higiene", slug: "papel-higiene", icono: "ScrollText" },
  { nombre: "Bebidas", slug: "bebidas", icono: "CupSoda" },
  { nombre: "Harinas y Menestras", slug: "harinas-menestras", icono: "Bean" },
  { nombre: "Desayuno y Snacks", slug: "desayuno-snacks", icono: "Cookie" },
  { nombre: "Cuidado del Hogar", slug: "cuidado-hogar", icono: "Home" },
  { nombre: "Mascotas", slug: "mascotas", icono: "PawPrint" },
  { nombre: "Panales y Bebe", slug: "panales-bebe", icono: "Baby" },
];

const categoryRules = [
  ["panales-bebe", /PA(?:N|Ñ)AL|BEBE|BABY|HUGGIES|PAMPERS|TOALLITAS/],
  ["mascotas", /MASCOTA|PERRO|GATO|DOG|CAT|RICOCAN|MIMASKOT/],
  ["detergentes-limpieza", /DETERGENTE|LEJIA|LAVAVAJILLA|LIMPIA|SAPOLIO|CLOROX|CLORO|AYUDIN|OPAL|ARIEL|BOLIVAR|MARSELLA|PATITO|SUAVITEL|POETT|PINESOL|CERA|DESINFECTANTE/],
  ["papel-higiene", /PAPEL|SERVILLETA|TOALLA|TISSUE|FACIAL|HIGIENICO|HIGI(?:E|É)NICO/],
  ["higiene-personal", /SHAMPOO|JABON|JAB(?:O|Ó)N|COLGATE|DENTAL|CREMA DENTAL|DESODORANTE|AFEITAR|GILLETTE|PEINE|CEPILLO|TALCO/],
  ["aceites-grasas", /ACEITE|MANTECA|MARGARINA|GRASA/],
  ["arroz-cereales", /ARROZ|CEREAL|QUINUA|KIWICHA|TRIGO|MAIZENA/],
  ["azucar-endulzantes", /AZUCAR|AZ(?:U|Ú)CAR|ENDULZANTE|PANELA|MIEL/],
  ["fideos-pastas", /FIDEO|TALLARIN|TALLAR(?:I|Í)N|SPAGHETTI|PASTA|CANUTO|MACARRON|MACARR(?:O|Ó)N|LASAGNA|RIGATONI|CODITO/],
  ["leche-lacteos", /LECHE|LACTEO|L(?:A|Á)CTEO|YOGUR|QUESO|MANTEQUILLA|EVAPORADA|CONDENSADA/],
  ["conservas-enlatados", /ATUN|AT(?:U|Ú)N|SARDINA|CONSERVA|ENLATADO|DURAZNO|FILETE|TROZOS|TROZADO|CHORITOS|CABALLA/],
  ["condimentos", /AJINOMEN|SAL |^SAL|SAZON|SAZONADOR|SIBARITA|TUCO|POMAROLA|COMINO|PIMIENTA|OREGANO|OR(?:E|É)GANO|VINAGRE|SILLAO|KETCHUP|MAYONESA|CALDO|CUBITO|CANELA|CONDIMENTO|AJI |AJ(?:I|Í)|MOSTAZA|AJO/],
  ["bebidas", /GASEOSA|BEBIDA|AGUA|JUGO|NECTAR|N(?:E|É)CTAR|FRUGOS|SPORADE|MALTIN|INKA|COCA|PEPSI|SPRITE|FANTA|CIFRUT|PULP/],
  ["harinas-menestras", /HARINA|LENTEJA|FREJOL|FRIJOL|GARBANZO|PALLAR|ARVEJA|MENESTRA|CHUNO|CHU(?:N|Ñ)O|MAIZ|MA(?:I|Í)Z|SEMOLA|S(?:E|É)MOLA/],
  ["cuidado-hogar", /BOLSA|ESCOBA|RECOGEDOR|FOSFORO|F(?:O|Ó)SFORO|VELA|PILA|INSECTICIDA|AMBIENTADOR|TRAPEADOR|ESPONJA|BALDE|GUANTE|LAVATODO|LAVATODO/],
  ["desayuno-snacks", /GALLETA|CHOCOLATE|CARAMELO|SNACK|CAF(?:E|É)|INFUSION|INFUSI(?:O|Ó)N|TE |T(?:E|É) |MILO|NESCAFE|GELATINA|FLAN|MAZAMORRA|AVENA|MERMELADA|PANETON|PANET(?:O|Ó)N/],
];

const brands = [
  { nombre: "Alicorp", slug: "alicorp", destacada: true, aliases: ["PRIMOR", "COCINERO", "DON VITTORIO", "BOLIVAR", "OPAL", "VICTORIA", "ALACENA", "BLANCA FLOR", "NICOLINI"] },
  { nombre: "Gloria", slug: "gloria", destacada: true, aliases: ["GLORIA", "PURA VIDA", "BONLE"] },
  { nombre: "Nestle", slug: "nestle", destacada: true, aliases: ["NESTLE", "NESCAFE", "MILO"] },
  { nombre: "Procter & Gamble", slug: "pg", destacada: true, aliases: ["PAMPERS", "ARIEL", "PANTENE", "HEAD"] },
  { nombre: "Unilever", slug: "unilever", destacada: true, aliases: ["DOVE", "REXONA", "SEDAL", "OMO", "LUX"] },
  { nombre: "Ajinomoto", slug: "ajinomoto", aliases: ["AJINOMEN", "AJINOMOTO"] },
  { nombre: "Molitalia", slug: "molitalia", aliases: ["MOLITALIA", "POMAROLA", "COSTA"] },
  { nombre: "Sapolio", slug: "sapolio", aliases: ["SAPOLIO"] },
  { nombre: "Clorox", slug: "clorox", aliases: ["CLOROX", "AYUDIN"] },
  { nombre: "Sibarita", slug: "sibarita", aliases: ["SIBARITA"] },
  { nombre: "Anita", slug: "anita", aliases: ["ANITA"] },
  { nombre: "Benoti", slug: "benoti", aliases: ["BENOTI"] },
  { nombre: "Herbi", slug: "herbi", aliases: ["HERBI"] },
  { nombre: "Umsha", slug: "umsha", aliases: ["UMSHA"] },
  { nombre: "Costa", slug: "costa", aliases: ["COSTA"] },
  { nombre: "Patrona", slug: "patrona", aliases: ["PATRONA"] },
  { nombre: "Alpa", slug: "alpa", aliases: ["ALPA"] },
  { nombre: "Deleite", slug: "deleite", aliases: ["DELEITE"] },
  { nombre: "Elite", slug: "elite", aliases: ["ELITE"] },
  { nombre: "Suave", slug: "suave", aliases: ["SUAVE"] },
];

function cleanText(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([/,.-])/g, "$1")
    .replace(/([/])\s+/g, "$1")
    .trim();
}

function toSlug(value) {
  return slugify(value, { lower: true, strict: true, locale: "es" });
}

function inferCategory(nombre) {
  const upper = nombre.toUpperCase();
  return categoryRules.find(([, rule]) => rule.test(upper))?.[0] ?? "desayuno-snacks";
}

function inferBrand(nombre) {
  const upper = nombre.toUpperCase();
  return brands.find((brand) => brand.aliases.some((alias) => upper.includes(alias)))?.slug ?? null;
}

function numberAt(rowItems, minX, maxX) {
  const values = rowItems
    .filter((item) => item.x >= minX && item.x < maxX)
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(" ")
    .match(/-?\d+(?:\.\d+)?/g);
  return values?.length ? Number(values[0]) : 0;
}

function textAt(rowItems, minX, maxX) {
  return cleanText(
    rowItems
      .filter((item) => item.x >= minX && item.x < maxX)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((item) => item.str)
      .filter((str) => str.trim())
      .join(" "),
  );
}

const raw = await fs.readFile(pdfPath);
const document = await pdfjsLib.getDocument({
  data: new Uint8Array(raw),
  disableWorker: true,
}).promise;

const products = [];

for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
  const page = await document.getPage(pageIndex);
  const content = await page.getTextContent();
  const items = content.items.map((item) => ({
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
  }));
  const rowNumberItems = items
    .filter((item) => item.x < 55 && /^\d+$/.test(item.str.trim()))
    .sort((a, b) => b.y - a.y);

  for (let index = 0; index < rowNumberItems.length; index += 1) {
    const currentRow = rowNumberItems[index];
    const previousY = rowNumberItems[index - 1]?.y ?? currentRow.y + 28;
    const nextY = rowNumberItems[index + 1]?.y ?? currentRow.y - 28;
    const upper = (previousY + currentRow.y) / 2;
    const lower = (currentRow.y + nextY) / 2;
    const rowItems = items.filter((item) => item.y <= upper && item.y >= lower);
    const codeItem = rowItems.find((item) => item.x >= 58 && item.x < 116 && /^(?:B\d{3,}|\d{5})$/.test(item.str.trim()));
    const nombre = textAt(rowItems, 118, 244);

    if (!nombre || !codeItem) continue;

    const codigoInterno = codeItem.str.trim();
    const precioUnitario = numberAt(rowItems, 420, 462);
    const stockActual = numberAt(rowItems, 286, 325);
    const stockMinimo = Math.max(1, Math.round(Math.abs(numberAt(rowItems, 244, 276)) || 1));
    const categorySlug = inferCategory(nombre);
    const brandSlug = inferBrand(nombre);
    const etiquetaMatch = nombre.match(/\b(?:X|x)\s?\d+\b|\b\d+\s?(?:KG|K|ML|GR|G|LT|L)\b/);

    products.push({
      codigoInterno,
      orden: Number(currentRow.str.trim()),
      nombre,
      slug: `${toSlug(nombre)}-${codigoInterno.toLowerCase()}`,
      descripcion: `${nombre} para venta mayorista B2B en Distribuidora Global Norte.`,
      categorySlug,
      brandSlug,
      precioUnitario,
      precioCaja: null,
      unidadesPorCaja: null,
      etiquetaCaja: etiquetaMatch ? etiquetaMatch[0].replace(/\s+/g, "") : null,
      precioAnterior: null,
      stock: Math.abs(Math.round(stockActual)),
      stockMinimo,
      unidad: /KG|K\b/.test(nombre.toUpperCase()) ? "kg" : /LT|L\b|ML/.test(nombre.toUpperCase()) ? "litro" : "unidad",
      imagenPrincipal: `/uploads/productos/${codigoInterno}.jpg`,
      destacado: products.length < 16,
      enOferta: false,
      nuevo: products.length > 392,
      agotado: Math.abs(Math.round(stockActual)) === 0,
      tags: [categorySlug, brandSlug, ...nombre.toLowerCase().split(/\s+/).slice(0, 6)].filter(Boolean),
      seoTitulo: `${nombre} | Global Norte`,
      seoDesc: `Compra ${nombre} al por mayor con entrega para bodegas y negocios.`,
    });
  }
}

const uniqueProducts = Array.from(
  new Map(products.map((product) => [product.codigoInterno, product])).values(),
).sort((a, b) => a.orden - b.orden);

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(
  outPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), categories, brands, products: uniqueProducts }, null, 2),
);

process.stdout.write(`Inventario extraido: ${uniqueProducts.length} productos -> ${outPath}\n`);
process.stdout.write(`Primero: ${uniqueProducts[0]?.codigoInterno} ${uniqueProducts[0]?.nombre}\n`);
process.stdout.write(`Ultimo: ${uniqueProducts.at(-1)?.codigoInterno} ${uniqueProducts.at(-1)?.nombre}\n`);
