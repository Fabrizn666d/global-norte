import slugify from "slugify";

export function money(value: number) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

export function shortDate(value: string | Date) {
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function makeSlug(value: string) {
  return slugify(value, { lower: true, strict: true, locale: "es" });
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("51")) return digits;
  if (digits.length === 9) return `51${digits}`;
  return digits;
}

export function toCsv(rows: Array<Record<string, string | number | boolean | null | undefined>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}
