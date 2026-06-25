"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Boxes,
  Building2,
  Eye,
  EyeOff,
  HelpCircle,
  Image as ImageIcon,
  Download,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  ShoppingCart,
  Tags,
  TicketPercent,
  Gift,
  BellRing,
  Truck,
  UsersRound,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { COMPANY } from "@/lib/company";

type AnyRow = Record<string, any>;
type Admin = { id: string; nombre: string; email: string; rol: string };
type AdminListResponse = {
  products?: AnyRow[];
  items?: AnyRow[];
  data?: { products?: AnyRow[]; items?: AnyRow[]; pagination?: AnyRow };
  pagination?: AnyRow;
};

const PLACEHOLDER_IMAGE = "/brand/global-norte-logo.jpg";
const nav = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/pedidos", label: "Pedidos", icon: ShoppingCart },
  { href: "/admin/consolidado", label: "Consolidado de carga", icon: Truck },
  { href: "/admin/productos", label: "Productos", icon: Boxes },
  { href: "/admin/categorias", label: "Categorias", icon: Tags },
  { href: "/admin/marcas", label: "Marcas", icon: Building2 },
  { href: "/admin/banners", label: "Banners", icon: ImageIcon },
  { href: "/admin/imagenes", label: "Imagenes", icon: ImageIcon },
  { href: "/admin/cupones", label: "Cupones", icon: TicketPercent },
  { href: "/admin/bonificaciones", label: "Bonificaciones", icon: Gift },
  { href: "/admin/notificaciones", label: "Notificaciones", icon: BellRing },
  { href: "/admin/backups", label: "Backups", icon: Download },
  { href: "/admin/sistema", label: "Sistema", icon: Settings },
  { href: "/admin/clientes", label: "Clientes", icon: UsersRound },
  { href: "/admin/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/admin/configuracion", label: "Configuracion", icon: Settings },
];

const colors = ["#D32F2F", "#1565C0", "#2E7D32", "#E65100", "#424242", "#EF5350"];
const orderStates = ["nuevo", "en_revision", "confirmado", "preparando", "entregado", "cancelado"];
const orderStateLabels: Record<string, string> = {
  nuevo: "Nuevo",
  en_revision: "En revision",
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  preparando: "Preparando",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

function money(value: number) {
  return `S/ ${Number(value || 0).toFixed(2)}`;
}

function jsonValues(value?: string | null) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.join(", ") : ""; } catch { return value || ""; }
}

function formData(event: FormEvent<HTMLFormElement>) {
  return Object.fromEntries(new FormData(event.currentTarget).entries());
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? controller.signal,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  }).finally(() => window.clearTimeout(timeout));
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la operacion");
  return data;
}

async function uploadAsset(file: File, folder: "products" | "banners") {
  const form = new FormData();
  form.set("file", file);
  form.set("folder", folder);
  const response = await fetch("/api/admin/upload", { method: "POST", body: form });
  const data = (await response.json().catch(() => ({}))) as { url?: string; data?: { url?: string }; error?: string };
  if (!response.ok) throw new Error(data.error ?? "No se pudo subir la imagen");
  return data.url ?? data.data?.url ?? "";
}

function adminProductsFromResponse(data: AdminListResponse) {
  return data.products ?? data.items ?? data.data?.products ?? data.data?.items ?? [];
}

function adminProductData(data: AdminListResponse) {
  const products = adminProductsFromResponse(data);
  return {
    ...data,
    products,
    pagination: data.pagination ?? data.data?.pagination ?? { page: 1, pages: products.length > 0 ? 1 : 0, total: products.length },
  };
}

export function AdminApp({ route }: { route: string[] }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnyRow>({});
  const [categories, setCategories] = useState<AnyRow[]>([]);
  const [brands, setBrands] = useState<AnyRow[]>([]);
  const [company, setCompany] = useState<AnyRow>(COMPANY);
  const active = route[0] ?? "dashboard";
  const detailId = route[1];

  const loadAdmin = useCallback(async () => {
    const [response, config] = await Promise.all([api<{ admin: Admin | null }>("/api/admin/auth/me"), api<{ company: AnyRow }>("/api/configuracion-publica")]);
    setAdmin(response.admin);
    setCompany(config.company);
  }, []);

  const loadData = useCallback(async () => {
    if (!admin) return;
    setLoading(true);
    try {
      if (active === "dashboard") setData(await api("/api/admin/reportes/dashboard"));
      if (active === "pedidos") setData(await api(detailId ? `/api/admin/pedidos/${detailId}` : "/api/admin/pedidos"));
      if (active === "productos") {
        const [products, cats, brs] = await Promise.all([
          api<AdminListResponse>("/api/admin/productos?limite=500"),
          api<{ categories: AnyRow[] }>("/api/admin/categorias"),
          api<{ brands: AnyRow[] }>("/api/admin/marcas"),
        ]);
        setData(adminProductData(products));
        setCategories(cats.categories);
        setBrands(brs.brands);
      }
      if (active === "categorias") setData(await api("/api/admin/categorias"));
      if (active === "marcas") setData(await api("/api/admin/marcas"));
      if (active === "banners") setData(await api("/api/admin/banners"));
      if (active === "imagenes") setData(await api("/api/admin/imagenes"));
      if (active === "cupones") setData(await api("/api/admin/cupones"));
      if (active === "bonificaciones") {
        const [bonuses, customers] = await Promise.all([api<AnyRow>("/api/admin/bonificaciones"), api<AnyRow>("/api/admin/clientes")]);
        setData({ ...bonuses, customers: customers.users ?? [] });
      }
      if (active === "notificaciones") {
        const [notifications, customers] = await Promise.all([api<AnyRow>("/api/admin/notificaciones"), api<AnyRow>("/api/admin/clientes")]);
        setData({ ...notifications, customers: customers.users ?? [] });
      }
      if (active === "consolidado") setData(await api("/api/admin/consolidado?periodo=hoy"));
      if (active === "backups") setData(await api("/api/admin/backups"));
      if (active === "sistema") setData(await api("/api/admin/sistema"));
      if (active === "clientes") setData(await api(detailId ? `/api/admin/clientes/${detailId}` : "/api/admin/clientes"));
      if (active === "reportes") {
        const [ventas, productos, categorias, inventario] = await Promise.all([
          api<AnyRow>("/api/admin/reportes/ventas"),
          api<AnyRow>("/api/admin/reportes/productos"),
          api<AnyRow>("/api/admin/reportes/categorias"),
          api<AnyRow>("/api/admin/reportes/inventario"),
        ]);
        setData({ ventas, productos, categorias, inventario });
      }
      if (active === "configuracion") setData(await api("/api/admin/configuracion"));
    } catch (error) {
      if (error instanceof Error) toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [active, admin, detailId]);

  useEffect(() => {
    loadAdmin().catch(() => setAdmin(null)).finally(() => setLoading(false));
  }, [loadAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function logout() {
    await api("/api/admin/auth/logout", { method: "POST" });
    setAdmin(null);
  }

  if (!admin) return <AdminLogin onLogin={setAdmin} loading={loading} />;

  return (
    <div className="min-h-screen bg-[#F8F8F8] text-neutral-900 lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="border-r border-neutral-200 bg-white">
        <div className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4">
          <img src={company.logoUrl || "/brand/global-norte-logo.jpg"} alt={company.name || "Global Norte"} className="h-12 w-12 object-contain" />
          <div>
            <p className="text-sm font-extrabold text-[#D32F2F]">{company.name || "Global Norte"}</p>
            <p className="text-xs font-semibold text-neutral-500">Panel Admin</p>
          </div>
        </div>
        <nav className="grid gap-1 p-3">
          {nav.map((item) => {
            const Icon = item.icon;
            const current = active === item.href.split("/").at(-1) || (active === "dashboard" && item.href === "/admin");
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-bold ${current ? "bg-[#FFF5F5] text-[#D32F2F]" : "text-neutral-700 hover:bg-neutral-50"}`}>
                <Icon className="h-4 w-4" /> {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-neutral-200 p-3">
          <Link href="/" className="mb-2 flex items-center gap-3 rounded px-3 py-2 text-sm font-bold text-neutral-700 hover:bg-neutral-50">
            <Building2 className="h-4 w-4" /> Ver tienda
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm font-bold text-neutral-700 hover:bg-neutral-50">
            <LogOut className="h-4 w-4" /> Cerrar sesion
          </button>
        </div>
      </aside>
      <main className="min-w-0">
        <header className="border-b border-neutral-200 bg-white px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[#D32F2F]">{admin.rol}</p>
          <h1 className="text-2xl font-extrabold">{titleFor(active)}</h1>
        </header>
        <div className="p-5">
          {loading ? <Loading /> : null}
          {active === "dashboard" ? <Dashboard data={data} /> : null}
          {active === "pedidos" ? <Orders data={data} detailId={detailId} reload={loadData} company={company} /> : null}
          {active === "productos" ? <Products data={data} categories={categories} brands={brands} reload={loadData} /> : null}
          {active === "categorias" ? <SimpleCrud kind="categorias" rows={data.categories ?? []} reload={loadData} /> : null}
          {active === "marcas" ? <SimpleCrud kind="marcas" rows={data.brands ?? []} reload={loadData} /> : null}
          {active === "banners" ? <Banners rows={data.banners ?? []} reload={loadData} /> : null}
          {active === "imagenes" ? <ProductImages data={data} reload={loadData} /> : null}
          {active === "cupones" ? <Coupons rows={data.coupons ?? []} reload={loadData} /> : null}
          {active === "bonificaciones" ? <Bonuses rows={data.bonuses ?? []} customers={data.customers ?? []} reload={loadData} /> : null}
          {active === "notificaciones" ? <Notifications rows={data.notifications ?? []} customers={data.customers ?? []} reload={loadData} /> : null}
          {active === "consolidado" ? <Consolidated initial={data} /> : null}
          {active === "backups" ? <Backups data={data} reload={loadData} /> : null}
          {active === "sistema" ? <SystemStatus data={data} /> : null}
          {active === "clientes" ? <Customers data={data} detailId={detailId} reload={loadData} /> : null}
          {active === "reportes" ? <Reports data={data} /> : null}
          {active === "configuracion" ? <SettingsView rows={data.settings ?? []} reload={loadData} /> : null}
        </div>
      </main>
    </div>
  );
}

function AdminLogin({ onLogin, loading }: { onLogin: (admin: Admin) => void; loading: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Ingresa tu email y contrasena de administrador.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = { email, password };
      const data = await api<{ admin: Admin }>("/api/admin/auth/login", { method: "POST", body: JSON.stringify(payload) });
      onLogin(data.admin);
      toast.success("Sesion iniciada");
      router.replace("/admin");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar sesion";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }
  const busy = submitting;
  return (
    <div className="grid min-h-screen place-items-center bg-[#F8F8F8] px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded border border-neutral-200 bg-white p-6 shadow-sm">
        <img src="/brand/global-norte-logo.jpg" alt="Global Norte" className="mx-auto mb-4 h-20 w-20 object-contain" />
        <h1 className="mb-5 text-center text-2xl font-extrabold">Global Norte - Panel Admin</h1>
        <Field name="email" label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" placeholder="admin@empresa.com" required />
        <label className="mb-3 grid gap-1 text-sm font-semibold text-neutral-700">
          Password
          <span className="relative">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              placeholder="Contrasena de administrador"
              required
              className="h-10 w-full rounded border border-neutral-300 px-3 pr-11 text-sm font-normal outline-none focus:border-[#D32F2F]"
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-neutral-500 hover:bg-neutral-100" title={showPassword ? "Ocultar password" : "Mostrar password"}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>
        {error ? <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        {loading ? <p className="mb-3 text-xs font-semibold text-neutral-500">Validando sesion guardada...</p> : null}
        <button type="submit" disabled={busy} className="mt-4 h-11 w-full rounded bg-[#D32F2F] text-sm font-bold text-white hover:bg-[#B71C1C] disabled:opacity-60">
          {busy ? "Validando" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string }) {
  const { label, help, ...inputProps } = props;
  return (
    <label className="mb-3 grid gap-1 text-sm font-semibold text-neutral-700">
      <span className="inline-flex items-center gap-1">
        {label}
        {help ? <HelpTip text={help} /> : null}
      </span>
      <input {...inputProps} className="h-10 rounded border border-neutral-300 px-3 text-sm font-normal outline-none focus:border-[#D32F2F]" />
    </label>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex" aria-hidden="true">
      <HelpCircle className="h-3.5 w-3.5 cursor-help text-neutral-400" />
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-56 -translate-x-1/2 rounded border border-neutral-200 bg-white p-2 text-xs font-semibold leading-5 text-neutral-600 shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

function titleFor(active: string) {
  const found = nav.find((item) => item.href.endsWith(active));
  return found?.label ?? "Dashboard";
}

function Loading() {
  return (
    <div className="grid min-h-60 place-items-center text-neutral-500">
      <span className="inline-flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-4 w-4 animate-spin" /> Cargando</span>
    </div>
  );
}

function Dashboard({ data }: { data: AnyRow }) {
  const kpis = data.kpis ?? {};
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Pedidos hoy" value={kpis.pedidosHoy ?? 0} />
        <Kpi label="Ventas hoy" value={money(kpis.ventasHoy ?? 0)} />
        <Kpi label="Productos" value={kpis.productos ?? 0} sub={`${kpis.sinStock ?? 0} sin stock`} />
        <Kpi label="Clientes" value={kpis.clientes ?? 0} sub={`${kpis.stockBajo ?? 0} stock bajo`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Pedidos y ventas">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.charts?.daily ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="fecha" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="ventas" stroke="#D32F2F" strokeWidth={2} />
              <Line type="monotone" dataKey="pedidos" stroke="#1565C0" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Productos mas pedidos">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.charts?.topProducts ?? []} layout="vertical">
              <XAxis type="number" />
              <YAxis type="category" dataKey="codigoInterno" width={80} />
              <Tooltip />
              <Bar dataKey="cantidad" fill="#D32F2F" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel title="Ultimos pedidos" help="Pedidos recientes registrados desde la tienda. Usa el modulo Pedidos para ver detalle, PDF y estados.">
        <OrdersTable orders={data.lastOrders ?? []} />
      </Panel>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-extrabold text-neutral-950">{value}</p>
      {sub ? <p className="mt-1 text-xs font-semibold text-neutral-500">{sub}</p> : null}
    </div>
  );
}

function Panel({ title, children, help }: { title: string; children: React.ReactNode; help?: string }) {
  return (
    <section className="rounded border border-neutral-200 bg-white p-4">
      <h2 className="mb-4 inline-flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-neutral-700">
        {title}
        {help ? <HelpTip text={help} /> : null}
      </h2>
      {children}
    </section>
  );
}

function Orders({ data, detailId, reload, company }: { data: AnyRow; detailId?: string; reload: () => void; company: AnyRow }) {
  async function setState(id: string, estado: string) {
    await api(`/api/admin/pedidos/${id}/estado`, { method: "PUT", body: JSON.stringify({ estado }) });
    toast.success("Estado actualizado");
    reload();
  }
  if (detailId && data.order) {
    const order = data.order;
    return (
      <div className="grid gap-4">
        <Panel title={`Proforma ${order.numero}`} help="Vista interna del pedido para validar stock, coordinar entrega y descargar proforma administrativa.">
          <div className="mb-4 grid gap-3 border-b border-neutral-200 pb-4 md:grid-cols-[120px_1fr_1fr]">
            <img src={PLACEHOLDER_IMAGE} alt="Global Norte" className="h-20 w-20 object-contain" />
            <div className="text-sm">
              <p className="font-extrabold">{company.legalName || company.name || "Distribuidora Global Norte E.I.R.L."}</p>
              <p>RUC {company.ruc}</p>
              <p>{company.address}</p>
            </div>
            <div className="text-sm">
              <p><strong>Cliente:</strong> {order.clienteNombre} {order.clienteApellido}</p>
              <p><strong>Telefono:</strong> {order.clienteTelefono}</p>
              <p><strong>Negocio:</strong> {order.clienteNegocio ?? "-"}</p>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {orderStates.map((state) => (
              <button key={state} onClick={() => setState(order.id, state)} className={`rounded border px-3 py-2 text-xs font-bold uppercase ${order.estado === state ? "border-[#D32F2F] bg-[#FFF5F5] text-[#D32F2F]" : "border-neutral-300"}`}>
                {orderStateLabels[state] ?? state}
              </button>
            ))}
            {order.pdfUrl ? <a href={`/api/pdf/${order.id}`} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold uppercase">PDF cliente</a> : null}
            <a href={`/api/admin/pedidos/${order.id}/pdf`} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold uppercase">PDF proforma</a>
            <button onClick={() => window.print()} className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold uppercase">Imprimir</button>
            <a href={`https://wa.me/${order.clienteTelefono.replace(/\D/g, "")}?text=${encodeURIComponent(`Pedido ${order.numero}: ${money(order.total)}`)}`} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold uppercase">WhatsApp</a>
            <a href={`https://wa.me/${company.whatsappNumber || COMPANY.whatsappNumber}?text=${encodeURIComponent(`Nuevo pedido Global Norte\n${order.numero}\nCliente: ${order.clienteNegocio ?? `${order.clienteNombre} ${order.clienteApellido}`}\nTelefono: ${order.clienteTelefono}\nTotal: ${money(order.total)}\nDetalle: /admin/pedidos/${order.id}`)}`} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold uppercase">WhatsApp interno</a>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Info label="Cliente" value={`${order.clienteNombre} ${order.clienteApellido}`} />
            <Info label="Entrega" value={`${order.entregaDireccion}, ${order.entregaDistrito}`} />
            <Info label="Metodo de entrega" value={order.metodoEntrega ?? "coordinada"} />
            <Info label="Telefono" value={order.clienteTelefono} />
            <Info label="Total" value={money(order.total)} />
          </div>
          {order.entregaMapsUrl ? <a href={order.entregaMapsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded bg-[#D32F2F] px-4 py-2 text-sm font-bold text-white">Abrir ubicacion</a> : null}
        </Panel>
        <Panel title="Productos pedidos" help="Detalle calculado desde base de datos. El total es referencial hasta confirmacion interna.">
          <DataTable rows={order.items ?? []} columns={["codigoInterno", "nombre", "cantidad", "precio", "subtotal"]} />
          <div className="mt-4 text-right text-xl font-extrabold text-[#D32F2F]">Total {money(order.total)}</div>
          {order.cuponCodigo ? <p className="mt-3 text-sm font-bold text-green-700">Cupon {order.cuponCodigo}: -{money(order.descuento)}</p> : null}
          {JSON.parse(order.bonificaciones || "[]").map((bonus: AnyRow, index: number) => <p key={`${bonus.name}-${index}`} className="mt-2 text-sm font-bold text-amber-700">Bonificacion / regalo: {bonus.name} (S/ 0.00)</p>)}
          {order.notasCliente ? <p className="mt-3 text-sm text-neutral-600">Observaciones: {order.notasCliente}</p> : null}
        </Panel>
      </div>
    );
  }
  return <AdvancedOrders initial={data} />;
}

function AdvancedOrders({ initial }: { initial: AnyRow }) {
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setResult(initial), [initial]);
  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const params = new URLSearchParams(formData(event) as Record<string, string>);
      Array.from(params.entries()).forEach(([key, value]) => { if (!value) params.delete(key); });
      setResult(await api(`/api/admin/pedidos?${params.toString()}`));
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo filtrar"); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Total" value={money(result.stats?.totalVentas ?? 0)} />
        <Kpi label="Pedidos" value={result.stats?.pedidos ?? 0} />
        <Kpi label="Ticket promedio" value={money(result.stats?.ticketPromedio ?? 0)} />
        <Kpi label="Entregados" value={result.stats?.entregados ?? 0} />
      </div>
      <Panel title="Filtros avanzados" help="Combina periodo, fecha, hora, cliente, entrega, pago y rango de total.">
        <form onSubmit={filter} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select name="periodo" className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm"><option value="">Periodo</option><option value="hoy">Hoy</option><option value="semana">Ultimos 7 dias</option></select>
          <input name="mes" type="month" className="h-10 rounded border border-neutral-300 px-3 text-sm" />
          <input name="desde" type="date" className="h-10 rounded border border-neutral-300 px-3 text-sm" />
          <input name="hasta" type="date" className="h-10 rounded border border-neutral-300 px-3 text-sm" />
          <div className="grid grid-cols-2 gap-2"><input name="horaDesde" type="time" className="h-10 min-w-0 rounded border border-neutral-300 px-2 text-sm" /><input name="horaHasta" type="time" className="h-10 min-w-0 rounded border border-neutral-300 px-2 text-sm" /></div>
          <input name="q" placeholder="Cliente o telefono" className="h-10 rounded border border-neutral-300 px-3 text-sm" />
          <select name="estado" className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm"><option value="">Estado</option>{orderStates.map((state) => <option key={state} value={state}>{orderStateLabels[state]}</option>)}</select>
          <select name="metodoEntrega" className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm"><option value="">Entrega</option><option value="coordinada">Coordinada</option><option value="recojo">Recojo</option></select>
          <select name="metodoPago" className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm"><option value="">Pago</option><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="yape">Yape</option><option value="plin">Plin</option></select>
          <div className="grid grid-cols-2 gap-2"><input name="totalMin" type="number" step="0.01" placeholder="Total min." className="h-10 min-w-0 rounded border border-neutral-300 px-2 text-sm" /><input name="totalMax" type="number" step="0.01" placeholder="Total max." className="h-10 min-w-0 rounded border border-neutral-300 px-2 text-sm" /></div>
          <button disabled={busy} className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white disabled:opacity-60">{busy ? "Filtrando" : "Aplicar filtros"}</button>
        </form>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Productos mas pedidos"><DataTable rows={result.month?.topProducts ?? []} columns={["nombre", "cantidad"]} /></Panel>
        <Panel title="Clientes con mas pedidos"><DataTable rows={result.month?.topCustomers ?? []} columns={["cliente", "pedidos"]} /></Panel>
      </div>
      <Panel title="Pedidos" help="Listado operativo filtrado."><OrdersTable orders={result.orders ?? []} /></Panel>
    </div>
  );
}

function OrdersTable({ orders }: { orders: AnyRow[] }) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const filtered = orders.filter((order) => {
    const term = q.trim().toLowerCase();
    const matchesTerm = !term || [order.numero, order.clienteNombre, order.clienteApellido, order.clienteNegocio, order.clienteTelefono].some((value) => String(value ?? "").toLowerCase().includes(term));
    const matchesState = !estado || order.estado === estado;
    return matchesTerm && matchesState;
  });
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Buscar pedido, cliente o telefono" className="h-10 rounded border border-neutral-300 px-3 text-sm" />
        <select value={estado} onChange={(event) => setEstado(event.target.value)} className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm">
          <option value="">Todos los estados</option>
          {orderStates.map((state) => <option key={state} value={state}>{orderStateLabels[state] ?? state}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2">Pedido</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Telefono</th>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Items</th>
            <th className="px-3 py-2">Total</th>
            <th className="px-3 py-2">Metodo</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((order) => (
            <tr key={order.id} className="border-t border-neutral-100">
              <td className="px-3 py-3 font-bold">{order.numero}</td>
              <td className="px-3 py-3">{order.clienteNegocio ?? `${order.clienteNombre} ${order.clienteApellido}`}</td>
              <td className="px-3 py-3">{order.clienteTelefono}</td>
              <td className="px-3 py-3">{order.createdAt ? new Date(order.createdAt).toLocaleDateString("es-PE") : "-"}</td>
              <td className="px-3 py-3">{order.items?.length ?? 0}</td>
              <td className="px-3 py-3 font-bold text-[#D32F2F]">{money(order.total)}</td>
              <td className="px-3 py-3">{order.metodoPago}</td>
              <td className="px-3 py-3">{orderStateLabels[order.estado] ?? order.estado}</td>
              <td className="px-3 py-3">
                <Link href={`/admin/pedidos/${order.id}`} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">Ver</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function Products({ data, categories, brands, reload }: { data: AnyRow; categories: AnyRow[]; brands: AnyRow[]; reload: () => void }) {
  const [editing, setEditing] = useState<AnyRow | null>(null);
  const [imageValue, setImageValue] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const pageSize = 50;
  const filteredProducts = (data.products ?? []).filter((product: AnyRow) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [product.codigoInterno, product.nombre, product.brand?.nombre].some((value) => String(value ?? "").toLowerCase().includes(term));
  });
  const pages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const visibleProducts = filteredProducts.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setImageValue(editing?.imagenPrincipal ?? "");
  }, [editing]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = formData(event);
    const payload = {
      codigoInterno: raw.codigoInterno,
      nombre: raw.nombre,
      categoryId: raw.categoryId,
      brandId: raw.brandId || null,
      precioUnitario: Number(raw.precioUnitario),
      precioCaja: raw.precioCaja ? Number(raw.precioCaja) : null,
      imagenPrincipal: imageValue || raw.imagenPrincipal || null,
      stock: Number(raw.stock ?? 0),
      stockMinimo: Number(raw.stockMinimo ?? 1),
      unidad: raw.unidad || "unidad",
      activo: true,
      destacado: Boolean(raw.destacado),
      mostrarEnHome: Boolean(raw.mostrarEnHome),
      ordenDestacado: Number(raw.ordenDestacado ?? 0),
      etiquetaDestacada: raw.etiquetaDestacada || null,
      enOferta: Boolean(raw.enOferta),
      nuevo: Boolean(raw.nuevo),
      tags: String(raw.nombre ?? "").toLowerCase().split(/\s+/).slice(0, 8),
    };
    await api(editing ? `/api/admin/productos/${editing.id}` : "/api/admin/productos", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    toast.success(editing ? "Producto actualizado" : "Producto creado");
    setSearch(String(payload.codigoInterno ?? ""));
    setPage(1);
    setEditing(null);
    form.reset();
    reload();
  }
  async function remove(row: AnyRow) {
    if (!window.confirm(`Eliminar ${row.nombre}?`)) return;
    await api(`/api/admin/productos/${row.id}`, { method: "DELETE" });
    toast.success("Producto eliminado");
    if (editing?.id === row.id) setEditing(null);
    reload();
  }
  return (
    <div className="grid gap-4">
      <Panel title={editing ? "Editar producto" : "Agregar producto"} help="Crea o actualiza productos del catalogo. Las imagenes se guardan en /uploads para que sean visibles desde cualquier dispositivo.">
        <form key={editing?.id ?? "new"} onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          <Field name="codigoInterno" label="Codigo interno" help="Identificador unico usado en catalogo, pedidos y PDF." defaultValue={editing?.codigoInterno ?? ""} required />
          <Field name="nombre" label="Nombre" help="Nombre comercial visible para clientes." defaultValue={editing?.nombre ?? ""} required />
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Categoria
            <select name="categoryId" required defaultValue={editing?.categoryId ?? editing?.category?.id ?? ""} className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-normal">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Marca
            <select name="brandId" defaultValue={editing?.brandId ?? editing?.brand?.id ?? ""} className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-normal">
              <option value="">Sin marca</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nombre}</option>)}
            </select>
          </label>
          <Field name="precioUnitario" label="P. unitario" help="Precio referencial por unidad que ve el cliente." type="number" step="0.01" defaultValue={editing?.precioUnitario ?? ""} required />
          <Field name="precioCaja" label="P. caja" help="Precio alternativo para venta por caja, si aplica." type="number" step="0.01" defaultValue={editing?.precioCaja ?? ""} />
          <Field name="stock" label="Stock" help="Cantidad disponible referencial. El pedido no descuenta stock automaticamente." type="number" defaultValue={editing?.stock ?? 0} />
          <Field name="stockMinimo" label="Stock minimo" help="Umbral para alertar stock bajo." type="number" defaultValue={editing?.stockMinimo ?? 1} />
          <Field name="unidad" label="Unidad" defaultValue={editing?.unidad ?? "unidad"} />
          <Field name="ordenDestacado" label="Orden en home" type="number" defaultValue={editing?.ordenDestacado ?? 0} />
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">Etiqueta destacada
            <select name="etiquetaDestacada" defaultValue={editing?.etiquetaDestacada ?? ""} className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-normal"><option value="">Sin etiqueta</option><option value="oferta">Oferta</option><option value="nuevo">Nuevo</option><option value="recomendado">Recomendado</option><option value="mas_vendido">Mas vendido</option></select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Imagen principal
            <input name="imagenPrincipal" value={imageValue} onChange={(event) => setImageValue(event.target.value)} className="h-10 rounded border border-neutral-300 px-3 text-sm font-normal outline-none focus:border-[#D32F2F]" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Subir imagen
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                setImageValue(await uploadAsset(file, "products"));
                toast.success("Imagen subida");
              } catch (error) {
                if (error instanceof Error) toast.error(error.message);
              }
            }} className="h-10 rounded border border-neutral-300 px-3 py-2 text-xs" />
          </label>
          <div className="flex flex-wrap items-center gap-4 md:col-span-4">
            <label className="inline-flex items-center gap-2 text-sm font-bold"><input name="destacado" type="checkbox" defaultChecked={editing?.destacado ?? false} /> Destacado</label>
            <label className="inline-flex items-center gap-2 text-sm font-bold"><input name="mostrarEnHome" type="checkbox" defaultChecked={editing?.mostrarEnHome ?? false} /> Mostrar en home</label>
            <label className="inline-flex items-center gap-2 text-sm font-bold"><input name="enOferta" type="checkbox" defaultChecked={editing?.enOferta ?? false} /> Oferta</label>
            <label className="inline-flex items-center gap-2 text-sm font-bold"><input name="nuevo" type="checkbox" defaultChecked={editing?.nuevo ?? false} /> Nuevo</label>
            <button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Guardar producto</button>
            {editing ? (
              <button type="button" onClick={() => setEditing(null)} className="h-10 rounded border border-neutral-300 px-4 text-sm font-bold">
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </Panel>
      <Panel title="Inventario" help="Administra el catalogo visible. Puedes buscar, editar, subir imagenes y crear productos temporales de prueba.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-10 rounded border border-neutral-300 px-3 text-sm" placeholder="Buscar codigo, nombre o marca" />
          <a href="/api/admin/productos/export" className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold uppercase">Exportar CSV</a>
          <span className="text-xs font-semibold text-neutral-500">{filteredProducts.length} productos</span>
        </div>
        <DataTable
          rows={visibleProducts}
          columns={["codigoInterno", "nombre", "precioUnitario", "stock", "destacado", "mostrarEnHome", "ordenDestacado"]}
          renderActions={(row) => (
            <div className="flex gap-2">
              <button onClick={() => setEditing(row)} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">Editar</button>
              <button onClick={() => remove(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">Eliminar</button>
            </div>
          )}
        />
        <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-neutral-600">
          <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-neutral-300 px-3 py-2 disabled:opacity-50">Anterior</button>
          <span>Pagina {page} de {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} className="rounded border border-neutral-300 px-3 py-2 disabled:opacity-50">Siguiente</button>
        </div>
      </Panel>
    </div>
  );
}

function SimpleCrud({ kind, rows, reload }: { kind: "categorias" | "marcas"; rows: AnyRow[]; reload: () => void }) {
  const [editing, setEditing] = useState<AnyRow | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = formData(event);
    await api(editing ? `/api/admin/${kind}/${editing.id}` : `/api/admin/${kind}`, {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify({
        nombre: raw.nombre,
        slug: raw.slug || undefined,
        descripcion: raw.descripcion,
        destacada: Boolean(raw.destacada),
        activo: editing?.activo ?? true,
        orden: editing?.orden ?? 0,
      }),
    });
    toast.success(editing ? "Registro actualizado" : "Registro creado");
    setEditing(null);
    form.reset();
    reload();
  }
  async function remove(row: AnyRow) {
    if (!window.confirm(`Eliminar ${row.nombre}?`)) return;
    try {
      await api(`/api/admin/${kind}/${row.id}`, { method: "DELETE" });
      toast.success("Registro eliminado");
      if (editing?.id === row.id) setEditing(null);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el registro");
    }
  }
  return (
    <div className="grid gap-4">
      <Panel title={editing ? `Editar ${kind}` : `Agregar ${kind}`} help={kind === "categorias" ? "Las categorias organizan el catalogo y aparecen como chips en la tienda." : "Las marcas permiten filtrar productos y mejorar la navegacion del cliente."}>
        <form key={editing?.id ?? "new"} onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          <Field name="nombre" label="Nombre" defaultValue={editing?.nombre ?? ""} required />
          <Field name="slug" label="Slug" defaultValue={editing?.slug ?? ""} />
          <Field name="descripcion" label="Descripcion" defaultValue={editing?.descripcion ?? ""} />
          <div className="flex gap-2 self-end">
            <button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Guardar</button>
            {editing ? <button type="button" onClick={() => setEditing(null)} className="h-10 rounded border border-neutral-300 px-4 text-sm font-bold">Cancelar</button> : null}
          </div>
        </form>
      </Panel>
      <Panel title={kind} help="Listado persistente en base de datos. Los cambios se reflejan inmediatamente en la tienda.">
        <DataTable
          rows={rows}
          columns={["nombre", "slug", "activo", "orden"]}
          renderActions={(row) => (
            <div className="flex gap-2">
              <button onClick={() => setEditing(row)} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">Editar</button>
              <button onClick={() => remove(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">Eliminar</button>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}

function Banners({ rows, reload }: { rows: AnyRow[]; reload: () => void }) {
  const [bannerImage, setBannerImage] = useState("");
  const [bannerMobile, setBannerMobile] = useState("");
  const [editing, setEditing] = useState<AnyRow | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = formData(event);
    await api(editing ? `/api/admin/banners/${editing.id}` : "/api/admin/banners", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify({
        titulo: raw.titulo,
        subtitulo: raw.subtitulo,
        descripcion: raw.descripcion,
        ctaTexto: raw.ctaTexto,
        ctaLink: raw.ctaLink,
        imagenDesktop: bannerImage || raw.imagenDesktop || editing?.imagenDesktop || PLACEHOLDER_IMAGE,
        imagenMobile: bannerMobile || raw.imagenMobile || editing?.imagenMobile || null,
        posicion: raw.posicion || "hero",
        tipo: raw.tipo || "principal_home",
        colorTexto: editing?.colorTexto || "light",
        activo: editing?.activo ?? true,
        orden: Number(raw.orden ?? editing?.orden ?? 0),
        fechaInicio: raw.fechaInicio || null,
        fechaFin: raw.fechaFin || null,
      }),
    });
    toast.success(editing ? "Banner actualizado" : "Banner creado");
    setEditing(null);
    setBannerImage("");
    setBannerMobile("");
    form.reset();
    reload();
  }
  async function toggle(row: AnyRow) {
    await api(`/api/admin/banners/${row.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...row, activo: !row.activo }),
    });
    toast.success(row.activo ? "Banner desactivado" : "Banner activado");
    reload();
  }
  async function remove(row: AnyRow) {
    if (!window.confirm(`Eliminar ${row.titulo}?`)) return;
    await api(`/api/admin/banners/${row.id}`, { method: "DELETE" });
    toast.success("Banner eliminado");
    reload();
  }
  return (
    <div className="grid gap-4">
      <Panel title={editing ? "Editar banner" : "Agregar banner"} help="Carga banners comerciales para usar en la tienda. Las imagenes se guardan en una ruta publica compatible con VPS.">
        <form key={editing?.id ?? "new"} onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          <Field name="titulo" label="Titulo" defaultValue={editing?.titulo ?? ""} required />
          <Field name="subtitulo" label="Subtitulo" defaultValue={editing?.subtitulo ?? ""} />
          <Field name="ctaTexto" label="CTA" defaultValue={editing?.ctaTexto ?? ""} />
          <Field name="ctaLink" label="URL" defaultValue={editing?.ctaLink ?? ""} />
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Imagen
            <input name="imagenDesktop" value={bannerImage} onChange={(event) => setBannerImage(event.target.value)} className="h-10 rounded border border-neutral-300 px-3 text-sm font-normal outline-none focus:border-[#D32F2F]" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Subir imagen
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                setBannerImage(await uploadAsset(file, "banners"));
                toast.success("Imagen subida");
              } catch (error) {
                if (error instanceof Error) toast.error(error.message);
              }
            }} className="h-10 rounded border border-neutral-300 px-3 py-2 text-xs" />
          </label>
          <Field name="posicion" label="Posicion" defaultValue={editing?.posicion ?? "hero"} />
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">Tipo
            <select name="tipo" defaultValue={editing?.tipo ?? "principal_home"} className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm"><option value="principal_home">Principal home</option><option value="catalogo">Catalogo</option><option value="carrito">Carrito</option><option value="modal">Modal emergente</option><option value="festiva">Fecha festiva</option></select>
          </label>
          <Field name="orden" label="Orden" type="number" defaultValue={editing?.orden ?? 0} />
          <Field name="fechaInicio" label="Inicio programado" type="datetime-local" defaultValue={editing?.fechaInicio ? String(editing.fechaInicio).slice(0, 16) : ""} />
          <Field name="fechaFin" label="Fin programado" type="datetime-local" defaultValue={editing?.fechaFin ? String(editing.fechaFin).slice(0, 16) : ""} />
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">Imagen movil
            <input name="imagenMobile" value={bannerMobile} onChange={(event) => setBannerMobile(event.target.value)} className="h-10 rounded border border-neutral-300 px-3 text-sm" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">Cargar archivo movil
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setBannerMobile(await uploadAsset(file, "banners")); toast.success("Imagen movil subida"); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo subir"); } }} className="h-10 rounded border border-neutral-300 px-3 py-2 text-xs" />
          </label>
          <div className="flex gap-2 self-end md:col-span-2">
            <button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Guardar</button>
            {editing ? <button type="button" onClick={() => { setEditing(null); setBannerImage(""); setBannerMobile(""); }} className="h-10 rounded border border-neutral-300 px-4 text-sm font-bold">Cancelar</button> : null}
          </div>
        </form>
      </Panel>
      <Panel title="Banners" help="Activa, desactiva o elimina banners guardados. Evita imagenes pesadas para mejorar rendimiento movil.">
        <DataTable
          rows={rows}
          columns={["titulo", "tipo", "posicion", "fechaInicio", "fechaFin", "activo", "orden"]}
          renderActions={(row) => (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(row); setBannerImage(row.imagenDesktop ?? ""); setBannerMobile(row.imagenMobile ?? ""); }} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">Editar</button>
              <button onClick={() => toggle(row)} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">{row.activo ? "Desactivar" : "Activar"}</button>
              <button onClick={() => remove(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">Eliminar</button>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}

function adminImageSrc(src?: string | null) {
  if (!src || src.includes("picsum.photos")) return "/brand/product-placeholder.svg";
  if (src.startsWith("/uploads/")) return `/api/media${src}`;
  return src;
}

function ProductImages({ data, reload }: { data: AnyRow; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [lastProgress, setLastProgress] = useState<AnyRow | null>(null);
  async function runFetch(limit: number | "all" = 50, action = "procesar") {
    const key = `${action}-${limit}`;
    setBusy(key);
    try {
      const result = await api<AnyRow>(`/api/admin/imagenes/${action}`, { method: "POST", body: JSON.stringify({ limit, all: limit === "all", retryErrors: action.includes("reintentar") }) });
      setLastProgress(result.progress ?? null);
      toast.success(`Imagenes procesadas: ${result.populated ?? 0}/${result.scanned ?? 0}`);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo buscar imagenes");
    } finally {
      setBusy(null);
    }
  }
  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
    setBusy("csv");
    try {
      if (file) {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/admin/imagenes/importar-csv", { method: "POST", body });
        const result = (await response.json().catch(() => ({}))) as AnyRow;
        if (!response.ok) throw new Error(result.error ?? "No se pudo importar CSV");
        toast.success(`CSV importado: ${result.imported ?? 0}/${result.total ?? 0}`);
      } else {
        const result = await api<AnyRow>("/api/admin/imagenes/importar-csv", { method: "POST", body: JSON.stringify({ csv }) });
        toast.success(`CSV importado: ${result.imported ?? 0}/${result.total ?? 0}`);
      }
      setCsv("");
      form.reset();
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo importar CSV");
    } finally {
      setBusy(null);
    }
  }
  async function approve(id: string) {
    await api(`/api/admin/imagenes/${id}/aprobar`, { method: "PUT", body: JSON.stringify({}) });
    toast.success("Imagen aprobada");
    reload();
  }
  async function reject(id: string) {
    await api(`/api/admin/imagenes/${id}/rechazar`, { method: "PUT", body: JSON.stringify({}) });
    toast.success("Imagen rechazada");
    reload();
  }
  async function retry(productId: string) {
    setBusy(productId);
    try {
      await api(`/api/admin/imagenes/retry/${productId}`, { method: "POST", body: JSON.stringify({}) });
      toast.success("Busqueda reintentada");
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se encontro imagen");
    } finally {
      setBusy(null);
    }
  }
  async function uploadManual(productId: string, file?: File) {
    if (!file) return;
    setBusy(productId);
    try {
      const localPath = await uploadAsset(file, "products");
      await api("/api/admin/imagenes/manual", { method: "POST", body: JSON.stringify({ productId, localPath }) });
      toast.success("Imagen manual guardada");
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar imagen");
    } finally {
      setBusy(null);
    }
  }
  async function auditQuality(action: "quality-audit" | "quality-fix") {
    setBusy(action);
    try {
      const result = await api<AnyRow>(`/api/admin/imagenes/${action}`, { method: "POST", body: JSON.stringify({}) });
      toast.success(action === "quality-audit" ? `Sospechosas: ${result.suspicious ?? 0}` : `Corregidas: ${result.fixed ?? 0}`);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo auditar calidad");
    } finally {
      setBusy(null);
    }
  }
  async function suspiciousAction(id: string, action: string) {
    setBusy(id);
    try {
      await api(`/api/admin/imagenes/sospechosas/${id}`, { method: "POST", body: JSON.stringify({ action }) });
      toast.success("Sospecha actualizada");
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar");
    } finally {
      setBusy(null);
    }
  }
  const pending = data.pending ?? [];
  const missing = data.missingProducts ?? [];
  const status = data.status ?? {};
  const progress = lastProgress ?? { done: status.withImage ?? 0, total: status.total ?? 0, percent: status.percent ?? 0, etaMinutes: null, speedPerMinute: null };
  const logs = data.logs ?? [];
  const suspicious = data.suspicious ?? [];
  return (
    <div className="grid gap-4">
      <Panel title="Estado Imagenes" help="Cola automatica con reintentos. Las imagenes aprobadas o manuales no se reemplazan; las nuevas se descargan, validan, convierten a WebP y se guardan localmente.">
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Total productos" value={status.total ?? 0} />
          <Kpi label="Con imagen" value={status.withImage ?? 0} />
          <Kpi label="Sin imagen" value={status.missing ?? missing.length} />
          <Kpi label="Pendientes cola" value={status.jobs?.pending ?? 0} />
        </div>
        <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4">
          <div className="mb-2 flex items-center justify-between text-sm font-black">
            <span>{progress.done ?? 0} / {progress.total ?? 0}</span>
            <span>{progress.percent ?? 0}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-[#D32F2F] transition-all" style={{ width: `${Math.min(100, Math.max(0, Number(progress.percent ?? 0)))}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold text-neutral-500">Velocidad: {progress.speedPerMinute ?? "-"} productos/min · ETA: {progress.etaMinutes ?? "-"} min · Rotas: {status.broken ?? 0} · Duplicadas: {status.duplicates ?? 0}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={Boolean(busy)} onClick={() => runFetch(50)} className="rounded bg-[#D32F2F] px-4 py-2 text-sm font-black text-white disabled:opacity-60">{busy === "procesar-50" ? "Procesando..." : "Procesar 50"}</button>
          <button disabled={Boolean(busy)} onClick={() => runFetch(100)} className="rounded border border-neutral-300 px-4 py-2 text-sm font-black disabled:opacity-60">Procesar 100</button>
          <button disabled={Boolean(busy)} onClick={() => runFetch("all")} className="rounded border border-neutral-300 px-4 py-2 text-sm font-black disabled:opacity-60">Procesar todas</button>
          <button disabled={Boolean(busy)} onClick={() => runFetch(100, "reintentar-pendientes")} className="rounded border border-neutral-300 px-4 py-2 text-sm font-black disabled:opacity-60">Reintentar pendientes</button>
          <button disabled={Boolean(busy)} onClick={() => runFetch(100, "reparar-rotas")} className="rounded border border-neutral-300 px-4 py-2 text-sm font-black disabled:opacity-60">Reparar imagenes rotas</button>
          <button disabled={Boolean(busy)} onClick={() => auditQuality("quality-audit")} className="rounded border border-neutral-300 px-4 py-2 text-sm font-black disabled:opacity-60">Auditar calidad</button>
          <button disabled={Boolean(busy)} onClick={() => auditQuality("quality-fix")} className="rounded border border-red-200 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-60">Limpiar sospechosas</button>
        </div>
      </Panel>
      <Panel title="Imagenes sospechosas" help="Preferimos dejar sin imagen antes que mostrar una falsa. Revisa, aprueba manualmente o rechaza y reencola.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {suspicious.map((issue: AnyRow) => (
            <div key={issue.id} className="rounded border border-red-100 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                <img src={adminImageSrc(issue.localPath)} alt={issue.product?.nombre ?? "Sospechosa"} className="h-24 w-24 rounded border border-neutral-200 object-contain" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase text-[#D32F2F]">{issue.product?.codigoInterno}</p>
                  <p className="line-clamp-2 text-sm font-black">{issue.product?.nombre}</p>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">{issue.product?.brand?.nombre ?? issue.product?.category?.nombre ?? "-"}</p>
                  <p className="mt-1 text-xs font-bold text-red-700">{issue.reason}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => suspiciousAction(issue.id, "aprobar")} className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black">Aprobar manualmente</button>
                <button onClick={() => suspiciousAction(issue.id, "rechazar")} className="rounded bg-[#D32F2F] px-3 py-1.5 text-xs font-black text-white">Rechazar</button>
                <button onClick={() => suspiciousAction(issue.id, "reintentar")} className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black">Reintentar</button>
                <button onClick={() => suspiciousAction(issue.id, "sin-imagen")} className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black">Dejar sin imagen</button>
              </div>
            </div>
          ))}
          {!suspicious.length ? <p className="text-sm font-semibold text-neutral-500">No hay imagenes sospechosas marcadas.</p> : null}
        </div>
      </Panel>
      <Panel title="Importar imagenes por CSV" help="Formato: codigoInterno,imageUrl,sourceUrl,sourceName. El sistema descarga cada imagen y guarda la ruta local en el producto.">
        <form onSubmit={importCsv} className="grid gap-3">
          <textarea value={csv} onChange={(event) => setCsv(event.target.value)} className="min-h-24 rounded border border-neutral-300 p-3 text-xs font-mono" placeholder="codigoInterno,imageUrl,sourceUrl,sourceName" />
          <div className="flex flex-wrap items-center gap-2">
            <input name="file" type="file" accept=".csv,text/csv" className="rounded border border-neutral-300 px-3 py-2 text-xs" />
            <button disabled={busy === "csv"} className="rounded bg-neutral-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60">{busy === "csv" ? "Importando..." : "Importar CSV"}</button>
          </div>
        </form>
      </Panel>
      <Panel title="Sugerencias pendientes">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pending.map((candidate: AnyRow) => (
            <div key={candidate.id} className="rounded border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                <img src={adminImageSrc(candidate.localPath)} alt={candidate.product?.nombre ?? "Imagen sugerida"} className="h-24 w-24 rounded border border-neutral-200 object-contain" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase text-[#D32F2F]">{candidate.product?.codigoInterno}</p>
                  <p className="line-clamp-2 text-sm font-black">{candidate.product?.nombre}</p>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">{candidate.product?.brand?.nombre ?? candidate.product?.category?.nombre ?? "-"}</p>
                  <p className="mt-1 text-xs font-bold">Confianza: {candidate.confidence}%</p>
                  <a href={candidate.sourceUrl ?? candidate.imageUrlOriginal} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#D32F2F] underline">Ver fuente</a>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => approve(candidate.id)} className="rounded bg-[#D32F2F] px-3 py-1.5 text-xs font-black text-white">Aprobar</button>
                <button onClick={() => reject(candidate.id)} className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black">Rechazar</button>
              </div>
            </div>
          ))}
          {!pending.length ? <p className="text-sm font-semibold text-neutral-500">No hay sugerencias pendientes.</p> : null}
        </div>
      </Panel>
      <Panel title="Productos sin imagen real">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {missing.map((product: AnyRow) => (
            <div key={product.id} className="rounded border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                <img src={adminImageSrc(product.imagenPrincipal)} alt={product.nombre} className="h-20 w-20 rounded border border-neutral-200 object-contain" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase text-[#D32F2F]">{product.codigoInterno}</p>
                  <p className="line-clamp-2 text-sm font-black">{product.nombre}</p>
                  <p className="text-xs font-semibold text-neutral-500">{product.brand?.nombre ?? product.category?.nombre ?? "-"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button disabled={busy === product.id} onClick={() => retry(product.id)} className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black disabled:opacity-60">{busy === product.id ? "Buscando" : "Reintentar busqueda"}</button>
                <label className="cursor-pointer rounded border border-neutral-300 px-3 py-1.5 text-xs font-black">
                  Subir manual
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => uploadManual(product.id, event.target.files?.[0])} />
                </label>
                <Link href={`/admin/productos`} className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-black">Ver producto</Link>
              </div>
            </div>
          ))}
          {!missing.length ? <p className="text-sm font-semibold text-neutral-500">Todos los productos revisados tienen imagen local real.</p> : null}
        </div>
      </Panel>
      <Panel title="Logs recientes">
        <DataTable
          rows={logs.map((log: AnyRow) => ({
            fecha: log.createdAt ? new Date(log.createdAt).toLocaleString("es-PE") : "-",
            producto: log.product ? `${log.product.codigoInterno} - ${log.product.nombre}` : log.productId,
            fuente: log.sourceName,
            resultado: log.result,
            confianza: log.confidence,
            error: log.error ?? "",
            ruta: log.localPath ?? "",
          }))}
          columns={["fecha", "producto", "fuente", "resultado", "confianza", "error", "ruta"]}
        />
      </Panel>
    </div>
  );
}

function Customers({ data, detailId, reload }: { data: AnyRow; detailId?: string; reload: () => void }) {
  if (detailId && data.user) {
    const user = data.user;
    return (
      <div className="grid gap-4">
        <Panel title={`${user.nombre} ${user.apellido}`}>
          <div className="grid gap-4 md:grid-cols-4">
            <Info label="Email" value={user.email} />
            <Info label="Telefono" value={user.telefono} />
            <Info label="Negocio" value={user.nombreNegocio ?? "-"} />
            <Info label="Total comprado" value={money(user.totalComprado ?? 0)} />
          </div>
        </Panel>
        <Panel title="Beneficios / excepciones" help="Configura condiciones exclusivas para este cliente. El backend las valida al registrar el pedido.">
          <form onSubmit={async (event) => { event.preventDefault(); const raw = formData(event); await api(`/api/admin/clientes/${user.id}/beneficios`, { method: "PUT", body: JSON.stringify({ ...raw, descuentoEspecial: Number(raw.descuentoEspecial ?? 0), aplicarAutomatico: Boolean(raw.aplicarAutomatico), activo: Boolean(raw.activo) }) }); toast.success("Beneficios guardados"); reload(); }} className="grid gap-3 md:grid-cols-3">
            <Field name="cuponExclusivo" label="Cupon exclusivo" defaultValue={user.benefit?.cuponExclusivo ?? ""} />
            <Field name="productoGratis" label="Producto gratis" defaultValue={user.benefit?.productoGratis ?? ""} />
            <Field name="bonificacionEspecial" label="Bonificacion especial" defaultValue={user.benefit?.bonificacionEspecial ?? ""} />
            <Field name="descuentoEspecial" label="Descuento especial %" type="number" step="0.01" defaultValue={user.benefit?.descuentoEspecial ?? 0} />
            <Field name="productosExcluidos" label="Productos excluidos (IDs)" defaultValue={jsonValues(user.benefit?.productosExcluidos)} />
            <Field name="productosExclusivos" label="Productos exclusivos (IDs)" defaultValue={jsonValues(user.benefit?.productosExclusivos)} />
            <Field name="notasInternas" label="Notas internas" defaultValue={user.benefit?.notasInternas ?? ""} />
            <label className="inline-flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="aplicarAutomatico" defaultChecked={user.benefit?.aplicarAutomatico ?? true} /> Aplicar automaticamente</label>
            <label className="inline-flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="activo" defaultChecked={user.benefit?.activo ?? true} /> Activo</label>
            <button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white md:col-span-3 md:w-fit">Guardar beneficios</button>
          </form>
        </Panel>
        <Panel title="Pedidos">
          <OrdersTable orders={user.orders ?? []} />
        </Panel>
      </div>
    );
  }
  const rows = (data.users ?? []).map((user: AnyRow) => ({
    id: user.id,
    nombre: `${user.nombre} ${user.apellido}`,
    email: user.email,
    telefono: user.telefono,
    negocio: user.nombreNegocio,
    pedidos: user.pedidos,
    totalComprado: money(user.totalComprado),
    estado: user.bloqueado ? "Bloqueado" : "Activo",
  }));
  return (
    <Panel title="Clientes">
      <DataTable rows={rows} columns={["nombre", "email", "telefono", "negocio", "pedidos", "totalComprado", "estado"]} linkPrefix="/admin/clientes" />
    </Panel>
  );
}

function Coupons({ rows, reload }: { rows: AnyRow[]; reload: () => void }) {
  const [editing, setEditing] = useState<AnyRow | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const raw = formData(event);
    await api(editing ? `/api/admin/cupones/${editing.id}` : "/api/admin/cupones", { method: editing ? "PUT" : "POST", body: JSON.stringify({
      ...raw, codigo: String(raw.codigo).toUpperCase(), valor: Number(raw.valor ?? 0), montoMinimo: Number(raw.montoMinimo ?? 0),
      limitePorCliente: Number(raw.limitePorCliente ?? 1), prioridad: Number(raw.prioridad ?? 0), cantidadMaximaUsos: raw.cantidadMaximaUsos ? Number(raw.cantidadMaximaUsos) : null,
      usoUnico: Boolean(raw.usoUnico), activo: Boolean(raw.activo),
    }) });
    toast.success(editing ? "Cupon actualizado" : "Cupon creado"); setEditing(null); form.reset(); reload();
  }
  async function remove(row: AnyRow) { if (!window.confirm(`Eliminar cupon ${row.codigo}?`)) return; await api(`/api/admin/cupones/${row.id}`, { method: "DELETE" }); toast.success("Cupon eliminado"); reload(); }
  return <div className="grid gap-4">
    <Panel title={editing ? "Editar cupon" : "Nuevo cupon"} help="La validacion de fechas, monto, productos y usos se realiza nuevamente en el backend al registrar el pedido.">
      <form key={editing?.id ?? "new"} onSubmit={submit} className="grid gap-3 md:grid-cols-4">
        <Field name="codigo" label="Codigo" defaultValue={editing?.codigo ?? ""} required /><Field name="descripcion" label="Descripcion" defaultValue={editing?.descripcion ?? ""} />
        <label className="grid gap-1 text-sm font-semibold">Tipo<select name="tipo" defaultValue={editing?.tipo ?? "fijo"} className="h-10 rounded border border-neutral-300 bg-white px-3"><option value="fijo">Descuento fijo</option><option value="porcentaje">Porcentaje</option><option value="regalo">Regalo</option><option value="beneficio">Envio / beneficio</option></select></label>
        <Field name="valor" label="Monto o porcentaje" type="number" step="0.01" defaultValue={editing?.valor ?? 0} /><Field name="regaloNombre" label="Regalo / beneficio" defaultValue={editing?.regaloNombre ?? ""} />
        <Field name="montoMinimo" label="Carrito minimo" type="number" step="0.01" defaultValue={editing?.montoMinimo ?? 0} /><Field name="limitePorCliente" label="Limite por cliente" type="number" defaultValue={editing?.limitePorCliente ?? 1} /><Field name="cantidadMaximaUsos" label="Maximo usos global" type="number" defaultValue={editing?.cantidadMaximaUsos ?? ""} /><Field name="prioridad" label="Prioridad" type="number" defaultValue={editing?.prioridad ?? 0} />
        <Field name="fechaInicio" label="Inicio" type="datetime-local" defaultValue={editing?.fechaInicio ? String(editing.fechaInicio).slice(0, 16) : ""} /><Field name="fechaFin" label="Fin" type="datetime-local" defaultValue={editing?.fechaFin ? String(editing.fechaFin).slice(0, 16) : ""} />
        <Field name="categoriasAplicables" label="Categorias (IDs separados por coma)" defaultValue={jsonValues(editing?.categoriasAplicables)} /><Field name="marcasAplicables" label="Marcas (IDs separados por coma)" defaultValue={jsonValues(editing?.marcasAplicables)} /><Field name="productosExcluidos" label="Productos excluidos (IDs)" defaultValue={jsonValues(editing?.productosExcluidos)} />
        <div className="flex flex-wrap items-center gap-4 md:col-span-4"><label className="inline-flex gap-2 text-sm font-bold"><input name="usoUnico" type="checkbox" defaultChecked={editing?.usoUnico ?? false} /> Uso unico</label><label className="inline-flex gap-2 text-sm font-bold"><input name="activo" type="checkbox" defaultChecked={editing?.activo ?? true} /> Activo</label><button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Guardar cupon</button>{editing ? <button type="button" onClick={() => setEditing(null)} className="h-10 rounded border px-4 text-sm font-bold">Cancelar</button> : null}</div>
      </form>
    </Panel>
    <Panel title="Cupones"><DataTable rows={rows} columns={["codigo", "tipo", "valor", "montoMinimo", "cantidadUsos", "activo", "fechaFin"]} renderActions={(row) => <div className="flex gap-2"><button onClick={() => setEditing(row)} className="rounded border px-2 py-1 text-xs font-bold">Editar</button><button onClick={() => remove(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">Eliminar</button></div>} /></Panel>
  </div>;
}

function Bonuses({ rows, customers, reload }: { rows: AnyRow[]; customers: AnyRow[]; reload: () => void }) {
  const [editing, setEditing] = useState<AnyRow | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const raw = formData(event); await api(editing ? `/api/admin/bonificaciones/${editing.id}` : "/api/admin/bonificaciones", { method: editing ? "PUT" : "POST", body: JSON.stringify({ ...raw, condicionValor: Number(raw.condicionValor ?? 0), activo: Boolean(raw.activo) }) }); toast.success(editing ? "Bonificacion actualizada" : "Bonificacion creada"); setEditing(null); form.reset(); reload(); }
  async function remove(row: AnyRow) { if (!window.confirm(`Eliminar ${row.nombre}?`)) return; await api(`/api/admin/bonificaciones/${row.id}`, { method: "DELETE" }); reload(); }
  return <div className="grid gap-4"><Panel title={editing ? "Editar bonificacion" : "Nueva bonificacion"}>
    <form key={editing?.id ?? "new"} onSubmit={submit} className="grid gap-3 md:grid-cols-4">
      <Field name="nombre" label="Nombre" defaultValue={editing?.nombre ?? ""} required /><Field name="codigoInterno" label="Codigo interno" defaultValue={editing?.codigoInterno ?? ""} /><Field name="descripcion" label="Descripcion" defaultValue={editing?.descripcion ?? ""} /><Field name="beneficio" label="Producto gratis / beneficio" defaultValue={editing?.beneficio ?? ""} required />
      <label className="grid gap-1 text-sm font-semibold">Condicion<select name="condicionTipo" defaultValue={editing?.condicionTipo ?? "monto"} className="h-10 rounded border bg-white px-3"><option value="monto">Desde monto</option><option value="cantidad">Desde cantidad</option><option value="categoria">Por categoria</option><option value="marca">Por marca</option><option value="cliente">Cliente especifico</option><option value="fecha">Por fecha</option></select></label>
      <Field name="condicionValor" label="Valor condicion" type="number" step="0.01" defaultValue={editing?.condicionValor ?? 0} /><Field name="categoryId" label="ID categoria" defaultValue={editing?.categoryId ?? ""} /><Field name="brandId" label="ID marca" defaultValue={editing?.brandId ?? ""} />
      <label className="grid gap-1 text-sm font-semibold">Cliente<select name="clienteId" defaultValue={editing?.clienteId ?? ""} className="h-10 rounded border bg-white px-3"><option value="">Todos</option>{customers.map((user) => <option key={user.id} value={user.id}>{user.nombreNegocio || `${user.nombre} ${user.apellido}`}</option>)}</select></label>
      <Field name="fechaInicio" label="Inicio" type="datetime-local" defaultValue={editing?.fechaInicio ? String(editing.fechaInicio).slice(0, 16) : ""} /><Field name="fechaFin" label="Fin" type="datetime-local" defaultValue={editing?.fechaFin ? String(editing.fechaFin).slice(0, 16) : ""} /><Field name="imagen" label="Imagen opcional" defaultValue={editing?.imagen ?? ""} />
      <div className="flex items-center gap-4 md:col-span-4"><label className="inline-flex gap-2 text-sm font-bold"><input name="activo" type="checkbox" defaultChecked={editing?.activo ?? true} /> Activa</label><button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Guardar</button>{editing ? <button type="button" onClick={() => setEditing(null)} className="h-10 rounded border px-4 text-sm font-bold">Cancelar</button> : null}</div>
    </form></Panel><Panel title="Bonificaciones"><DataTable rows={rows} columns={["nombre", "condicionTipo", "condicionValor", "beneficio", "activo", "fechaFin"]} renderActions={(row) => <div className="flex gap-2"><button onClick={() => setEditing(row)} className="rounded border px-2 py-1 text-xs font-bold">Editar</button><button onClick={() => remove(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">Eliminar</button></div>} /></Panel></div>;
}

function Notifications({ rows, customers, reload }: { rows: AnyRow[]; customers: AnyRow[]; reload: () => void }) {
  const [editing, setEditing] = useState<AnyRow | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const raw = formData(event); await api(editing ? `/api/admin/notificaciones/${editing.id}` : "/api/admin/notificaciones", { method: editing ? "PUT" : "POST", body: JSON.stringify({ ...raw, activo: Boolean(raw.activo) }) }); toast.success(editing ? "Notificacion actualizada" : "Notificacion creada"); setEditing(null); form.reset(); reload(); }
  async function remove(row: AnyRow) { if (!window.confirm(`Eliminar ${row.titulo}?`)) return; await api(`/api/admin/notificaciones/${row.id}`, { method: "DELETE" }); reload(); }
  return <div className="grid gap-4"><Panel title={editing ? "Editar notificacion" : "Nueva notificacion"}>
    <form key={editing?.id ?? "new"} onSubmit={submit} className="grid gap-3 md:grid-cols-4"><Field name="titulo" label="Titulo" defaultValue={editing?.titulo ?? ""} required /><Field name="mensaje" label="Mensaje (usa {nombre})" defaultValue={editing?.mensaje ?? ""} required />
      <label className="grid gap-1 text-sm font-semibold">Tipo<select name="tipo" defaultValue={editing?.tipo ?? "aviso_home"} className="h-10 rounded border bg-white px-3"><option value="popup">Popup</option><option value="banner">Banner pequeno</option><option value="aviso_carrito">Aviso en carrito</option><option value="aviso_home">Aviso en home</option></select></label>
      <label className="grid gap-1 text-sm font-semibold">Publico<select name="publico" defaultValue={editing?.publico ?? "todos"} className="h-10 rounded border bg-white px-3"><option value="todos">Todos</option><option value="registrados">Registrados</option><option value="cliente">Cliente especifico</option></select></label>
      <label className="grid gap-1 text-sm font-semibold">Cliente<select name="clienteId" defaultValue={editing?.clienteId ?? ""} className="h-10 rounded border bg-white px-3"><option value="">Ninguno</option>{customers.map((user) => <option key={user.id} value={user.id}>{user.nombreNegocio || `${user.nombre} ${user.apellido}`}</option>)}</select></label>
      <Field name="fechaInicio" label="Inicio" type="datetime-local" defaultValue={editing?.fechaInicio ? String(editing.fechaInicio).slice(0, 16) : ""} /><Field name="fechaFin" label="Fin" type="datetime-local" defaultValue={editing?.fechaFin ? String(editing.fechaFin).slice(0, 16) : ""} />
      <div className="flex items-center gap-4 md:col-span-4"><label className="inline-flex gap-2 text-sm font-bold"><input name="activo" type="checkbox" defaultChecked={editing?.activo ?? true} /> Activa</label><button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Guardar</button>{editing ? <button type="button" onClick={() => setEditing(null)} className="h-10 rounded border px-4 text-sm font-bold">Cancelar</button> : null}</div>
    </form></Panel><Panel title="Notificaciones"><DataTable rows={rows} columns={["titulo", "tipo", "publico", "fechaInicio", "fechaFin", "activo"]} renderActions={(row) => <div className="flex gap-2"><button onClick={() => setEditing(row)} className="rounded border px-2 py-1 text-xs font-bold">Editar</button><button onClick={() => remove(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">Eliminar</button></div>} /></Panel></div>;
}

function Consolidated({ initial }: { initial: AnyRow }) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("periodo=hoy");
  const [busy, setBusy] = useState(false);
  useEffect(() => setData(initial), [initial]);
  async function filter(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const params = new URLSearchParams(formData(event) as Record<string, string>); Array.from(params.entries()).forEach(([key, value]) => { if (!value) params.delete(key); }); const next = params.toString(); setQuery(next); setBusy(true); try { setData(await api(`/api/admin/consolidado?${next}`)); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo generar"); } finally { setBusy(false); } }
  return <div className="grid gap-4"><Panel title="Consolidado de carga" help="Suma los productos de todos los pedidos filtrados para preparar y cargar el camion.">
    <form onSubmit={filter} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><select name="periodo" defaultValue="hoy" className="h-10 rounded border bg-white px-3 text-sm"><option value="hoy">Hoy</option><option value="semana">Ultimos 7 dias</option><option value="">Personalizado</option></select><input name="mes" type="month" className="h-10 rounded border px-3 text-sm" /><input name="desde" type="date" className="h-10 rounded border px-3 text-sm" /><input name="hasta" type="date" className="h-10 rounded border px-3 text-sm" /><div className="grid grid-cols-2 gap-2"><input name="horaDesde" type="time" className="h-10 min-w-0 rounded border px-2" /><input name="horaHasta" type="time" className="h-10 min-w-0 rounded border px-2" /></div><select name="estado" className="h-10 rounded border bg-white px-3 text-sm"><option value="">Sin cancelados</option>{orderStates.map((state) => <option key={state} value={state}>{orderStateLabels[state]}</option>)}</select><button disabled={busy} className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">{busy ? "Calculando" : "Generar"}</button></form>
    <div className="mt-4 flex flex-wrap gap-2"><a href={`/api/admin/consolidado/pdf?${query}`} target="_blank" rel="noreferrer" className="rounded border px-3 py-2 text-xs font-bold uppercase">Descargar PDF</a><a href={`/api/admin/consolidado/csv?${query}`} className="rounded border px-3 py-2 text-xs font-bold uppercase">Exportar CSV / Excel</a><button onClick={() => window.print()} className="rounded border px-3 py-2 text-xs font-bold uppercase">Imprimir</button></div>
  </Panel><div className="grid gap-4 md:grid-cols-3"><Kpi label="Pedidos" value={data.summary?.orders ?? 0} /><Kpi label="Productos agrupados" value={data.summary?.products ?? 0} /><Kpi label="Total referencial" value={money(data.summary?.total ?? 0)} /></div><Panel title="Productos para carga"><DataTable rows={data.rows ?? []} columns={["codigo", "producto", "categoria", "marca", "unidad", "cantidad", "precioReferencial", "subtotal", "pedidos", "observacion"]} /></Panel></div>;
}

function Backups({ data, reload }: { data: AnyRow; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [restorePlan, setRestorePlan] = useState<AnyRow | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [catalogFile, setCatalogFile] = useState<File | null>(null);
  async function generate(tipo: string) {
    setBusy(tipo);
    try {
      await api("/api/admin/backups", { method: "POST", body: JSON.stringify({ tipo }) });
      toast.success("Backup generado");
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el backup");
    } finally {
      setBusy(null);
    }
  }
  async function validateRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restoreFile) return toast.error("Selecciona un backup ZIP");
    const form = new FormData();
    form.set("file", restoreFile);
    setBusy("restore-check");
    try {
      const response = await fetch("/api/admin/backups/restore", { method: "POST", body: form });
      const result = (await response.json().catch(() => ({}))) as AnyRow;
      if (!response.ok) throw new Error(result.error ?? "Backup invalido");
      setRestorePlan(result.plan);
      toast.success("Backup validado. Confirma para restaurar.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo validar");
    } finally {
      setBusy(null);
    }
  }
  async function applyRestore() {
    if (!restoreFile || !window.confirm("Restaurar reemplazara la DB/uploads/PDFs actuales. Se generara backup previo. Continuar?")) return;
    const form = new FormData();
    form.set("file", restoreFile);
    form.set("apply", "true");
    setBusy("restore-apply");
    try {
      const response = await fetch("/api/admin/backups/restore", { method: "POST", body: form });
      const result = (await response.json().catch(() => ({}))) as AnyRow;
      if (!response.ok) throw new Error(result.error ?? "No se pudo restaurar");
      toast.success("Backup restaurado. Reinicia PM2 para recargar conexiones.");
      setRestorePlan(null);
      setRestoreFile(null);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo restaurar");
    } finally {
      setBusy(null);
    }
  }
  async function importCatalog() {
    if (!catalogFile) return toast.error("Selecciona un ZIP de catalogo");
    const form = new FormData();
    form.set("file", catalogFile);
    setBusy("catalog-import");
    try {
      const response = await fetch("/api/admin/catalogo/sincronizar", { method: "POST", body: form });
      const result = (await response.json().catch(() => ({}))) as AnyRow;
      if (!response.ok) throw new Error(result.error ?? "No se pudo importar catalogo");
      toast.success(`Catalogo sincronizado: ${result.products ?? 0} productos`);
      setCatalogFile(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo importar catalogo");
    } finally {
      setBusy(null);
    }
  }
  const backups = data.backups ?? [];
  return <div className="grid gap-4">
    <Panel title="Backups" help="Descarga copias respaldables de SQLite, uploads, PDFs o un ZIP completo. Guarda estos archivos fuera del servidor.">
      <button disabled={Boolean(busy)} onClick={() => generate("complete")} className="mb-4 w-full rounded-2xl bg-[#D32F2F] px-5 py-5 text-lg font-black uppercase text-white shadow-lg transition hover:bg-[#B71C1C] disabled:opacity-60">
        {busy === "complete" ? "Generando backup completo..." : "Generar backup completo"}
      </button>
      <div className="grid gap-3 md:grid-cols-4">
        {[{ tipo: "database", label: "Backup DB" }, { tipo: "uploads", label: "Backup uploads" }, { tipo: "pdfs", label: "Backup PDFs" }, { tipo: "complete", label: "Descargar todo" }].map((item) => (
          <button key={item.tipo} disabled={Boolean(busy)} onClick={() => generate(item.tipo)} className="rounded bg-[#D32F2F] px-4 py-3 text-sm font-black text-white disabled:opacity-60">{busy === item.tipo ? "Generando" : item.label}</button>
        ))}
      </div>
      <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <p><strong>Ultimo backup:</strong> {data.lastBackup?.completedAt ? new Date(data.lastBackup.completedAt).toLocaleString("es-PE") : "Aun no generado"}</p>
        <p className="mt-2">Restaurar: detener PM2, reemplazar `data/globalnorte.db`, copiar `uploads/` y `pdfs/`, ejecutar `npx prisma generate`, `npx prisma db push` y reiniciar.</p>
      </div>
    </Panel>
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Restaurar backup" help="Primero valida el ZIP. Al confirmar se crea un backup previo y se restauran DB, uploads y PDFs. Reinicia PM2 despues.">
        <form onSubmit={validateRestore} className="grid gap-3">
          <input type="file" accept=".zip,application/zip" onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} className="rounded border border-neutral-300 px-3 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button disabled={busy === "restore-check"} className="rounded border border-neutral-300 px-4 py-2 text-sm font-black">{busy === "restore-check" ? "Validando..." : "Validar backup"}</button>
            {restorePlan?.ok ? <button type="button" disabled={busy === "restore-apply"} onClick={applyRestore} className="rounded bg-neutral-900 px-4 py-2 text-sm font-black text-white">{busy === "restore-apply" ? "Restaurando..." : "Confirmar restauracion"}</button> : null}
          </div>
        </form>
        {restorePlan ? <pre className="mt-3 max-h-56 overflow-auto rounded bg-neutral-950 p-3 text-xs text-white">{JSON.stringify(restorePlan.summary ?? restorePlan, null, 2)}</pre> : null}
      </Panel>
      <Panel title="Sincronizar catalogo" help="Exporta o importa productos, categorias, marcas, banners, configuracion e imagenes sin tocar clientes, usuarios, pedidos ni historial.">
        <div className="grid gap-3">
          <a href="/api/admin/catalogo/export" className="rounded bg-[#D32F2F] px-4 py-3 text-center text-sm font-black uppercase text-white">Exportar catalogo</a>
          <input type="file" accept=".zip,application/zip" onChange={(event) => setCatalogFile(event.target.files?.[0] ?? null)} className="rounded border border-neutral-300 px-3 py-2 text-sm" />
          <button onClick={importCatalog} disabled={busy === "catalog-import"} className="rounded border border-neutral-300 px-4 py-3 text-sm font-black">{busy === "catalog-import" ? "Sincronizando..." : "Sincronizar catalogo"}</button>
        </div>
      </Panel>
    </div>
    <Panel title="Historial de backups">
      <DataTable rows={backups.map((backup: AnyRow) => ({ ...backup, size: `${Math.round((backup.size || 0) / 1024)} KB`, fecha: backup.completedAt ? new Date(backup.completedAt).toLocaleString("es-PE") : "-" }))} columns={["tipo", "estado", "fileName", "size", "fecha", "checksum"]} renderActions={(row) => row.estado === "completado" ? <a href={`/api/admin/backups/${row.id}/download`} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">Descargar</a> : null} />
    </Panel>
  </div>;
}

function formatBytes(value: number) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function SystemStatus({ data }: { data: AnyRow }) {
  const counts = data.counts ?? {};
  const images = data.images ?? {};
  const db = data.database ?? {};
  const storage = data.storage ?? {};
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Productos" value={counts.products ?? 0} />
        <Kpi label="Clientes" value={counts.clients ?? 0} />
        <Kpi label="Pedidos" value={counts.orders ?? 0} />
        <Kpi label="Imagenes rotas" value={images.brokenCount ?? 0} />
      </div>
      <Panel title="Base de datos y runtime">
        <div className="grid gap-3 md:grid-cols-2">
          <Info label="DB usada" value={db.url} />
          <Info label="Ruta DB" value={db.path} />
          <Info label="Peso DB" value={formatBytes(db.size)} />
          <Info label="Existe DB" value={db.exists ? "Si" : "No"} />
          <Info label="Version" value={data.app?.version} />
          <Info label="Commit" value={data.app?.commit} />
          <Info label="Uptime" value={`${data.app?.uptimeSeconds ?? 0}s`} />
          <Info label="PM2" value={data.runtime?.pm2?.detected ? `Activo (${data.runtime.pm2.id})` : "No detectado en este proceso"} />
        </div>
      </Panel>
      <Panel title="Almacenamiento persistente">
        <div className="grid gap-3 md:grid-cols-3">
          <Info label="Uploads" value={`${storage.uploads?.path ?? "-"} - ${formatBytes(storage.uploads?.size)}`} />
          <Info label="PDFs" value={`${storage.pdfs?.path ?? "-"} - ${formatBytes(storage.pdfs?.size)}`} />
          <Info label="Backups" value={`${storage.backups?.path ?? "-"} - ultimo: ${storage.backups?.lastBackup?.completedAt ? new Date(storage.backups.lastBackup.completedAt).toLocaleString("es-PE") : "sin backup"}`} />
        </div>
      </Panel>
      <Panel title="Auditoria de imagenes">
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Productos sin imagen" value={images.missing ?? 0} />
          <Kpi label="Productos con picsum" value={images.picsum ?? 0} />
          <Kpi label="Imagenes en DB" value={counts.mediaAssets ?? 0} />
          <Kpi label="Rotas" value={images.brokenCount ?? 0} />
        </div>
        <DataTable rows={images.broken ?? []} columns={["codigoInterno", "nombre", "imagenPrincipal"]} />
      </Panel>
      <Panel title="Conteos de negocio">
        <DataTable rows={Object.entries(counts).map(([clave, valor]) => ({ clave, valor }))} columns={["clave", "valor"]} />
      </Panel>
    </div>
  );
}

function Reports({ data }: { data: AnyRow }) {
  const pieData = data.categorias?.rows ?? [];
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Ventas diarias">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.ventas?.rows ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="fecha" />
              <YAxis />
              <Tooltip />
              <Line dataKey="ventas" stroke="#D32F2F" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Ventas por categoria">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} dataKey="ingresos" nameKey="categoria" innerRadius={60} outerRadius={100}>
                {pieData.map((_: AnyRow, index: number) => <Cell key={index} fill={colors[index % colors.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel title="Top productos">
        <DataTable rows={data.productos?.rows ?? []} columns={["codigoInterno", "nombre", "unidades", "ingresos"]} />
      </Panel>
      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="Valor inventario" value={money(data.inventario?.valorTotal ?? 0)} />
        <Kpi label="Stock bajo" value={data.inventario?.stockBajo?.length ?? 0} />
        <Kpi label="Agotados" value={data.inventario?.agotados?.length ?? 0} />
      </div>
    </div>
  );
}

function SettingsView({ rows, reload }: { rows: AnyRow[]; reload: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settings = rows.map((row) => ({ clave: row.clave, valor: String(new FormData(event.currentTarget).get(row.clave) ?? "") }));
    await api("/api/admin/configuracion", { method: "PUT", body: JSON.stringify({ settings }) });
    toast.success("Configuracion guardada");
    reload();
  }
  const grouped = useMemo(() => {
    return rows.reduce<Record<string, AnyRow[]>>((acc, row) => {
      const group = row.grupo ?? "general";
      acc[group] = [...(acc[group] ?? []), row];
      return acc;
    }, {});
  }, [rows]);
  return (
    <form onSubmit={submit} className="grid gap-4">
      {Object.entries(grouped).map(([group, items]) => (
        <Panel key={group} title={group}>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <Field key={item.id} name={item.clave} label={item.label ?? item.clave} defaultValue={item.valor} />
            ))}
          </div>
        </Panel>
      ))}
      <button className="h-11 rounded bg-[#D32F2F] px-5 text-sm font-bold text-white md:w-fit">Guardar configuracion</button>
    </form>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-neutral-900">{value}</p>
    </div>
  );
}

function DataTable({
  rows,
  columns,
  linkPrefix,
  renderActions,
}: {
  rows: AnyRow[];
  columns: string[];
  linkPrefix?: string;
  renderActions?: (row: AnyRow) => React.ReactNode;
}) {
  const hasActions = Boolean(linkPrefix || renderActions);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            {columns.map((column) => <th key={column} className="px-3 py-2">{column}</th>)}
            {hasActions ? <th className="px-3 py-2">Acciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index} className="border-t border-neutral-100">
              {columns.map((column) => (
                <td key={column} className="max-w-[320px] truncate px-3 py-3">
                  {typeof row[column] === "number" && column.toLowerCase().includes("precio") ? money(row[column]) : String(row[column] ?? "")}
                </td>
              ))}
              {hasActions ? (
                <td className="px-3 py-3">
                  {renderActions ? renderActions(row) : <Link href={`${linkPrefix}/${row.id}`} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">Ver</Link>}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
