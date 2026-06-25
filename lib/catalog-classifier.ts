import { prisma } from "@/lib/db";

type Rule = { category: string; patterns: RegExp[] };

const rules: Rule[] = [
  { category: "Mascotas", patterns: [/mascota/i, /\bcat\b/i, /\bdog\b/i, /super cat/i, /michicat/i, /ricocan/i, /perro/i, /gato/i] },
  { category: "Higiene Personal", patterns: [/shampoo/i, /hh\.?ss/i, /jabon/i, /jab[oó]n/i, /papel/i, /toalla/i, /pa[nñ]al/i, /colgate/i, /cepillo/i, /dental/i] },
  { category: "Detergentes y Limpieza", patterns: [/detergente/i, /lavavaj/i, /limpiador/i, /lej[ií]a/i, /sapolio/i, /bolivar/i, /downy/i] },
  { category: "Arroz y Cereales", patterns: [/\barroz\b/i, /cereal/i, /trigo/i, /mote/i] },
  { category: "Fideos y Pastas", patterns: [/fideo/i, /pasta/i, /tallar[ií]n/i, /spagu/i, /municion/i, /plumilla/i, /cabello de [aá]ngel/i] },
  { category: "Aceites y Grasas", patterns: [/aceite/i, /manteca/i, /margarina/i] },
  { category: "Azucar y Endulzantes", patterns: [/az[uú]car/i, /endulz/i, /edulcor/i] },
  { category: "Leche y Lacteos", patterns: [/leche/i, /yogurt/i, /evaporada/i, /gloria azul/i] },
  { category: "Conservas y Enlatados", patterns: [/at[uú]n/i, /conserva/i, /sardina/i, /filete/i] },
  { category: "Condimentos y Sazonadores", patterns: [/tuco/i, /ajinomoto/i, /sazonador/i, /pimienta/i, /comino/i, /sibarita/i, /palillo/i, /ketchup/i, /sillao/i, /vinagre/i, /aji/i, /ají/i] },
  { category: "Desayuno y Snacks", patterns: [/galleta/i, /snack/i, /cancha/i, /chizito/i, /porcor/i, /cereal/i, /gelatina/i, /filtrante/i, /avena/i] },
];

export async function classifyCatalog({ apply = false } = {}) {
  const categories = await prisma.category.findMany();
  const byName = new Map(categories.map((category) => [category.nombre.toLowerCase(), category]));
  const products = await prisma.product.findMany({ include: { category: true, brand: true }, orderBy: { codigoInterno: "asc" } });
  const suggestions = [];
  for (const product of products) {
    const nameOnly = product.nombre;
    const text = `${product.nombre} ${product.brand?.nombre ?? ""}`;
    const snackName = /papit|galleta|snack|cancha|chizito|porcor/i.test(nameOnly);
    const rule = snackName
      ? rules.find((item) => item.category === "Desayuno y Snacks")
      : rules.find((item) => item.patterns.some((pattern) => pattern.test(text)));
    if (!rule) continue;
    const target = byName.get(rule.category.toLowerCase());
    if (!target || target.id === product.categoryId) continue;
    suggestions.push({
      id: product.id,
      codigoInterno: product.codigoInterno,
      nombre: product.nombre,
      actual: product.category.nombre,
      sugerida: target.nombre,
      targetCategoryId: target.id,
    });
  }
  if (apply) {
    for (const item of suggestions) {
      await prisma.product.update({ where: { id: item.id }, data: { categoryId: item.targetCategoryId } });
    }
  }
  return { apply, total: products.length, changes: suggestions.length, suggestions };
}
