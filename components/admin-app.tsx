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
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  ShoppingCart,
  Tags,
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
  { href: "/admin/productos", label: "Productos", icon: Boxes },
  { href: "/admin/categorias", label: "Categorias", icon: Tags },
  { href: "/admin/marcas", label: "Marcas", icon: Building2 },
  { href: "/admin/banners", label: "Banners", icon: ImageIcon },
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
  const active = route[0] ?? "dashboard";
  const detailId = route[1];

  const loadAdmin = useCallback(async () => {
    const response = await api<{ admin: Admin | null }>("/api/admin/auth/me");
    setAdmin(response.admin);
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
          <img src="/brand/global-norte-logo.jpg" alt="Global Norte" className="h-12 w-12 object-contain" />
          <div>
            <p className="text-sm font-extrabold text-[#D32F2F]">Global Norte</p>
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
          {active === "pedidos" ? <Orders data={data} detailId={detailId} reload={loadData} /> : null}
          {active === "productos" ? <Products data={data} categories={categories} brands={brands} reload={loadData} /> : null}
          {active === "categorias" ? <SimpleCrud kind="categorias" rows={data.categories ?? []} reload={loadData} /> : null}
          {active === "marcas" ? <SimpleCrud kind="marcas" rows={data.brands ?? []} reload={loadData} /> : null}
          {active === "banners" ? <Banners rows={data.banners ?? []} reload={loadData} /> : null}
          {active === "clientes" ? <Customers data={data} detailId={detailId} /> : null}
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

function Orders({ data, detailId, reload }: { data: AnyRow; detailId?: string; reload: () => void }) {
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
              <p className="font-extrabold">Distribuidora Global Norte E.I.R.L.</p>
              <p>RUC 20608628461</p>
              <p>Carabayllo, Lima</p>
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
            <a href={`https://wa.me/${COMPANY.whatsappNumber}?text=${encodeURIComponent(`Nuevo pedido Global Norte\n${order.numero}\nCliente: ${order.clienteNegocio ?? `${order.clienteNombre} ${order.clienteApellido}`}\nTelefono: ${order.clienteTelefono}\nTotal: ${money(order.total)}\nDetalle: /admin/pedidos/${order.id}`)}`} target="_blank" rel="noreferrer" className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold uppercase">WhatsApp interno</a>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Info label="Cliente" value={`${order.clienteNombre} ${order.clienteApellido}`} />
            <Info label="Entrega" value={`${order.entregaDireccion}, ${order.entregaDistrito}`} />
            <Info label="Telefono" value={order.clienteTelefono} />
            <Info label="Total" value={money(order.total)} />
          </div>
        </Panel>
        <Panel title="Productos pedidos" help="Detalle calculado desde base de datos. El total es referencial hasta confirmacion interna.">
          <DataTable rows={order.items ?? []} columns={["codigoInterno", "nombre", "cantidad", "precio", "subtotal"]} />
          <div className="mt-4 text-right text-xl font-extrabold text-[#D32F2F]">Total {money(order.total)}</div>
          {order.notasCliente ? <p className="mt-3 text-sm text-neutral-600">Observaciones: {order.notasCliente}</p> : null}
        </Panel>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Total" value={money(data.stats?.totalVentas ?? 0)} />
        <Kpi label="Pedidos" value={data.stats?.pedidos ?? 0} />
        <Kpi label="Ticket promedio" value={money(data.stats?.ticketPromedio ?? 0)} />
        <Kpi label="Entregados" value={data.stats?.entregados ?? 0} />
      </div>
      <Panel title="Pedidos" help="Listado operativo para buscar pedidos, revisar estados y abrir cada detalle.">
        <OrdersTable orders={data.orders ?? []} />
      </Panel>
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
          <div className="flex gap-2 md:col-span-4">
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
          columns={["codigoInterno", "nombre", "precioUnitario", "precioCaja", "stock", "activo"]}
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
        imagenMobile: editing?.imagenMobile || null,
        posicion: raw.posicion || "hero",
        colorTexto: editing?.colorTexto || "light",
        activo: editing?.activo ?? true,
        orden: Number(raw.orden ?? editing?.orden ?? 0),
      }),
    });
    toast.success(editing ? "Banner actualizado" : "Banner creado");
    setEditing(null);
    setBannerImage("");
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
          <Field name="orden" label="Orden" type="number" defaultValue={editing?.orden ?? 0} />
          <div className="flex gap-2 self-end md:col-span-2">
            <button className="h-10 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Guardar</button>
            {editing ? <button type="button" onClick={() => { setEditing(null); setBannerImage(""); }} className="h-10 rounded border border-neutral-300 px-4 text-sm font-bold">Cancelar</button> : null}
          </div>
        </form>
      </Panel>
      <Panel title="Banners" help="Activa, desactiva o elimina banners guardados. Evita imagenes pesadas para mejorar rendimiento movil.">
        <DataTable
          rows={rows}
          columns={["titulo", "posicion", "activo", "clics", "orden"]}
          renderActions={(row) => (
            <div className="flex gap-2">
              <button onClick={() => { setEditing(row); setBannerImage(row.imagenDesktop ?? ""); }} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">Editar</button>
              <button onClick={() => toggle(row)} className="rounded border border-neutral-300 px-2 py-1 text-xs font-bold">{row.activo ? "Desactivar" : "Activar"}</button>
              <button onClick={() => remove(row)} className="rounded border border-red-200 px-2 py-1 text-xs font-bold text-red-600">Eliminar</button>
            </div>
          )}
        />
      </Panel>
    </div>
  );
}

function Customers({ data, detailId }: { data: AnyRow; detailId?: string }) {
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
