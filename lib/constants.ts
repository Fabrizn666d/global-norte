export const ORDER_STATES = [
  "nuevo",
  "en_revision",
  "pendiente",
  "confirmado",
  "preparando",
  "entregado",
  "cancelado",
] as const;

export const PAYMENT_METHODS = ["efectivo", "transferencia", "yape", "plin"] as const;

export const stateLabels: Record<string, string> = {
  nuevo: "Nuevo",
  en_revision: "En revision",
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  preparando: "Preparando",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const paymentLabels: Record<string, string> = {
  efectivo: "Efectivo contra entrega",
  transferencia: "Transferencia bancaria",
  yape: "Yape",
  plin: "Plin",
};

export function stateTone(state: string) {
  if (state === "entregado") return "bg-green-50 text-green-700 border-green-200";
  if (state === "cancelado") return "bg-red-50 text-red-700 border-red-200";
  if (state === "nuevo" || state === "pendiente") return "bg-orange-50 text-orange-700 border-orange-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
}
