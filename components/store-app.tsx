"use client";

import Link from "next/link";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  ClipboardList,
  Loader2,
  LogOut,
  Mail,
  Menu,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { COMPANY } from "@/lib/company";

type Category = { id: string; nombre: string; slug: string; icono?: string | null; _count?: { products: number } };
type Brand = { id: string; nombre: string; slug: string; destacada: boolean; _count?: { products: number } };
type Banner = { id: string; titulo: string; subtitulo?: string | null; descripcion?: string | null; ctaTexto?: string | null; ctaLink?: string | null; imagenDesktop: string; imagenMobile?: string | null; activo: boolean; posicion?: string; tipo?: string };
type StoreNotification = { id: string; titulo: string; mensaje: string; tipo: string };
type CommerceBenefit = { subtotal: number; discount: number; total: number; coupon?: { code: string; description: string } | null; bonuses: Array<{ name: string; description?: string; quantity: number }>; customerBenefit?: { couponCode?: string | null; message?: string | null } | null };
type CompanyContact = { name: string; ruc: string; whatsappDisplay: string; whatsappNumber: string; email: string; address: string };
type Product = {
  id: string;
  codigoInterno: string;
  nombre: string;
  slug: string;
  descripcion?: string | null;
  precioUnitario: number;
  precioCaja?: number | null;
  unidadesPorCaja?: number | null;
  etiquetaCaja?: string | null;
  precioAnterior?: number | null;
  stock: number;
  stockMinimo: number;
  unidad: string;
  imagenPrincipal?: string | null;
  destacado: boolean;
  enOferta: boolean;
  nuevo: boolean;
  mostrarEnHome?: boolean;
  ordenDestacado?: number;
  etiquetaDestacada?: string | null;
  category: Category;
  brand?: Brand | null;
};
type CartItem = { id: string; cantidad: number; tipoPrecio: string; product: Product };
type Cart = { id: string; items: CartItem[] };
type User = {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  dni?: string | null;
  ruc?: string | null;
  nombreNegocio?: string | null;
  tipoNegocio?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  direccion?: string | null;
  referencia?: string | null;
};
type Order = {
  id: string;
  numero: string;
  estado: string;
  metodoPago: string;
  total: number;
  descuento?: number;
  cuponCodigo?: string | null;
  bonificaciones?: string;
  entregaMapsUrl?: string | null;
  pdfUrl?: string | null;
  createdAt: string;
  items: Array<{ id: string; codigoInterno: string; nombre: string; cantidad: number; precio: number; subtotal: number }>;
};
type ProductListResponse = {
  products?: Product[];
  items?: Product[];
  data?: { products?: Product[]; items?: Product[]; pagination?: { page: number; pages: number; total: number } };
  pagination?: { page: number; pages: number; total: number };
  success?: boolean;
};
type CartPayloadItem = { productId: string; cantidad: number; tipoPrecio: string };

const PLACEHOLDER_IMAGE = "/brand/product-placeholder.svg";
const LOGO_IMAGE = "/brand/global-norte-logo.jpg";
const CART_STORAGE_KEY = "gn_cart_v2";
const COUPON_STORAGE_KEY = "gn_coupon_v1";

const stateLabel: Record<string, string> = {
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

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? controller.signal,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  }).finally(() => window.clearTimeout(timeout));
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la operacion");
  return data;
}

function formData(event: FormEvent<HTMLFormElement>) {
  return Object.fromEntries(new FormData(event.currentTarget).entries());
}

function itemPrice(item: CartItem) {
  return item.tipoPrecio === "caja" && item.product.precioCaja ? item.product.precioCaja : item.product.precioUnitario;
}

function makeCartItemId(productId: string, tipoPrecio: string) {
  return `${productId}:${tipoPrecio}`;
}

function imageSrc(value?: string | null) {
  const src = value?.trim();
  if (!src || src.includes("picsum.photos")) return PLACEHOLDER_IMAGE;
  if (src.startsWith("/uploads/")) return `/api/media${src}`;
  return src;
}

function usePlaceholderImage(event: React.SyntheticEvent<HTMLImageElement>) {
  if (event.currentTarget.src.endsWith(PLACEHOLDER_IMAGE)) return;
  event.currentTarget.src = PLACEHOLDER_IMAGE;
}

function ProductImage({
  src,
  alt,
  className,
  loading,
}: {
  src?: string | null;
  alt: string;
  className: string;
  loading?: "eager" | "lazy";
}) {
  const [currentSrc, setCurrentSrc] = useState(imageSrc(src));
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setCurrentSrc(imageSrc(src));
    const timeout = window.setTimeout(() => {
      const image = imageRef.current;
      if (image && (!image.complete || image.naturalWidth === 0)) {
        setCurrentSrc(PLACEHOLDER_IMAGE);
      }
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [src]);

  return <img ref={imageRef} src={currentSrc} onError={usePlaceholderImage} alt={alt} className={className} loading={loading} />;
}

function routeKey(route: string[]) {
  return route.join("/");
}

function productsFromResponse(data: ProductListResponse) {
  return data.products ?? data.items ?? data.data?.products ?? data.data?.items ?? [];
}

function paginationFromResponse(data: ProductListResponse, count: number) {
  return data.pagination ?? data.data?.pagination ?? { page: 1, pages: count > 0 ? 1 : 0, total: count };
}

export function StoreApp({ route }: { route: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [related, setRelated] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [notifications, setNotifications] = useState<StoreNotification[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [company, setCompany] = useState<CompanyContact>(COMPANY);
  const [cart, setCart] = useState<Cart | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const routePath = routeKey(route);
  const queryString = searchParams.toString();
  const view = route[0] ?? "home";
  const key = `${routePath}?${queryString}`;

  const cartCount = useMemo(() => cart?.items.reduce((sum, item) => sum + item.cantidad, 0) ?? 0, [cart]);
  const cartTotal = useMemo(() => cart?.items.reduce((sum, item) => sum + itemPrice(item) * item.cantidad, 0) ?? 0, [cart]);

  const saveCart = useCallback((nextCart: Cart) => {
    setCart(nextCart);
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
  }, []);

  const loadBase = useCallback(async () => {
    const [categoryData, brandData, bannerData, companyData, meData, notificationData] = await Promise.all([
      api<{ categories: Category[] }>("/api/categorias"),
      api<{ brands: Brand[] }>("/api/marcas"),
      api<{ banners: Banner[] }>("/api/banners"),
      api<{ company: CompanyContact }>("/api/configuracion-publica"),
      api<{ user: User | null }>("/api/customer/me"),
      api<{ notifications: StoreNotification[] }>("/api/notificaciones"),
    ]);
    setCategories(categoryData.categories);
    setBrands(brandData.brands);
    setBanners(bannerData.banners);
    setCompany(companyData.company);
    setUser(meData.user);
    setAuthReady(true);
    const dismissed = new Set<string>(JSON.parse(window.localStorage.getItem("gn_dismissed_notifications") || "[]"));
    setNotifications(notificationData.notifications.filter((item) => !dismissed.has(item.id)));
  }, []);

  useEffect(() => {
    loadBase().catch((error: Error) => {
      setAuthReady(true);
      toast.error(error.message);
    });
  }, [loadBase]);

  useEffect(() => {
    const saved = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!saved) {
      setCart({ id: "local", items: [] });
      return;
    }
    try {
      const parsed = JSON.parse(saved) as Cart;
      setCart({ id: "local", items: Array.isArray(parsed.items) ? parsed.items : [] });
    } catch {
      setCart({ id: "local", items: [] });
    }
  }, []);

  useEffect(() => {
    let active = true;
    const currentRoute = routePath ? routePath.split("/") : [];
    const currentView = currentRoute[0] ?? "home";
    const currentSearch = new URLSearchParams(queryString);
    async function load() {
      setLoading(true);
      setProduct(null);
      setOrder(null);
      setCatalogError(null);
      try {
        if (currentView === "catalogo" && currentRoute[1]) {
          const data = await api<{ product: Product; related: Product[] }>(`/api/productos/${currentRoute[1]}`);
          if (!active) return;
          setProduct(data.product);
          setRelated(data.related);
          return;
        }

        if (currentView === "mi-cuenta" && currentRoute[1] === "pedidos" && currentRoute[2]) {
          const data = await api<{ order: Order }>(`/api/pedidos/${currentRoute[2]}`);
          if (active) setOrder(data.order);
          return;
        }

        if (currentView === "mi-cuenta" && currentRoute[1] === "pedidos") {
          const data = await api<{ orders: Order[] }>("/api/mis-pedidos");
          if (active) setOrders(data.orders);
          return;
        }

        if (currentView === "pedido-confirmado" && currentSearch.get("id")) {
          const data = await api<{ order: Order }>(`/api/pedidos/${currentSearch.get("id")}`);
          if (active) setOrder(data.order);
          return;
        }

        if (["home", "catalogo", "categoria", "marca"].includes(currentView)) {
          const params = new URLSearchParams(queryString);
          if (currentView === "home") {
            params.set("home", "1");
            params.set("limite", "16");
          } else if (!params.has("limite")) {
            params.set("limite", window.innerWidth < 640 ? "12" : "24");
          }
          if (currentView === "categoria" && currentRoute[1]) params.set("categoria", currentRoute[1]);
          if (currentView === "marca" && currentRoute[1]) params.set("marca", currentRoute[1]);
          const endpoint = `/api/productos?${params.toString()}`;
          const data = await api<ProductListResponse>(endpoint);
          const nextProducts = productsFromResponse(data);
          const nextPagination = paginationFromResponse(data, nextProducts.length);
          if (!active) return;
          setProducts(nextProducts);
          setPagination(nextPagination);
        }
      } catch (error) {
        if (error instanceof Error && !["login", "registro"].includes(currentView)) {
          setCatalogError(error.message);
          toast.error(error.message);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [key, queryString, routePath]);

  async function addToCart(productId: string, tipoPrecio = "unidad", cantidad = 1) {
    const found = [product, ...products, ...related].find((item): item is Product => Boolean(item && item.id === productId));
    if (!found) {
      toast.error("Producto no disponible");
      return;
    }
    const normalizedType = tipoPrecio === "caja" && found.precioCaja ? "caja" : "unidad";
    const currentCart = cart ?? { id: "local", items: [] };
    const itemId = makeCartItemId(found.id, normalizedType);
    const existing = currentCart.items.find((item) => item.id === itemId);
    const nextItems = existing
      ? currentCart.items.map((item) => item.id === itemId ? { ...item, cantidad: item.cantidad + cantidad } : item)
      : [...currentCart.items, { id: itemId, cantidad, tipoPrecio: normalizedType, product: found }];
    saveCart({ id: "local", items: nextItems });
    toast.success("Producto agregado al pedido");
  }

  async function updateCartItem(itemId: string, cantidad: number) {
    const currentCart = cart ?? { id: "local", items: [] };
    saveCart({ ...currentCart, items: currentCart.items.map((item) => item.id === itemId ? { ...item, cantidad: Math.max(1, cantidad) } : item) });
  }

  async function removeCartItem(itemId: string) {
    const currentCart = cart ?? { id: "local", items: [] };
    saveCart({ ...currentCart, items: currentCart.items.filter((item) => item.id !== itemId) });
  }

  function clearCart() {
    saveCart({ id: "local", items: [] });
  }

  async function logout() {
    await api("/api/customer/logout", { method: "POST" });
    setUser(null);
    router.push("/");
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    router.push(`/catalogo${params.toString() ? `?${params}` : ""}`);
  }

  function dismissNotification(id: string) {
    const current = JSON.parse(window.localStorage.getItem("gn_dismissed_notifications") || "[]") as string[];
    window.localStorage.setItem("gn_dismissed_notifications", JSON.stringify(Array.from(new Set<string>([...current, id]))));
    setNotifications((items) => items.filter((item) => item.id !== id));
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-neutral-950">
      <header className="sticky top-0 z-40 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
        <div className="bg-[#D71920] text-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 text-[11px] font-bold uppercase tracking-wide sm:text-xs">
            <span className="inline-flex items-center gap-2"><Store className="h-4 w-4" /> Mayorista B2B en Lima Norte</span>
            <div className="hidden items-center gap-5 md:flex">
              <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4" /> WhatsApp {company.whatsappDisplay}</span>
              <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" /> {company.email}</span>
              <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" /> Entrega coordinada</span>
            </div>
          </div>
        </div>

        <div className="border-b border-black/5 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-3 lg:grid-cols-[245px_1fr_auto_auto_auto]">
            <Link href="/" className="flex shrink-0 items-center gap-3">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
                <img src={LOGO_IMAGE} alt="Global Norte" className="h-12 w-12 object-contain" />
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-sm font-black uppercase text-[#D71920]">Global Norte</span>
                <span className="block text-[11px] font-bold uppercase tracking-wide text-neutral-500">Distribuidora mayorista</span>
              </span>
            </Link>

            <form onSubmit={search} className="relative order-last col-span-4 md:order-none md:col-span-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 w-full rounded-2xl border border-neutral-200 bg-[#F7F7F8] pl-12 pr-4 text-sm font-medium outline-none transition focus:border-[#D71920] focus:bg-white focus:shadow-[0_0_0_4px_rgba(215,25,32,0.08)]"
                placeholder="Buscar abarrotes, limpieza, higiene, codigos o marcas"
              />
            </form>

            <nav className="hidden items-center gap-1 lg:flex">
              <HeaderLink href="/catalogo" label="Catalogo" />
              <HeaderLink href="/catalogo?oferta=1" label="Ofertas" />
              <HeaderLink href="/#marcas" label="Marcas" />
              <HeaderLink href="/mi-cuenta/pedidos" label="Pedidos" />
            </nav>

            {user ? (
              <div className="hidden items-center gap-2 sm:flex">
                <Link href="/mi-cuenta" className="inline-flex h-11 max-w-[170px] items-center gap-2 truncate rounded-xl border border-neutral-200 bg-white px-3 text-xs font-extrabold shadow-sm transition hover:border-[#D71920]" title="Mi cuenta">
                  <UserRound className="h-4 w-4 shrink-0 text-[#D71920]" /> <span className="truncate">{user.nombreNegocio || user.nombre}</span>
                </Link>
                <button onClick={logout} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:border-[#D71920]" title="Cerrar sesion">
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <Link href="/login" className="hidden h-11 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-extrabold shadow-sm transition hover:border-[#D71920] sm:inline-flex" title="Ingresar">
                <UserRound className="h-4 w-4 text-[#D71920]" /> Ingresar / Registrarse
              </Link>
            )}

            <Link href="/carrito" className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#1F1F1F] text-white shadow-sm transition hover:bg-[#D71920]" title="Carrito">
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 ? (
                <span className="absolute -right-2 -top-2 grid min-w-6 place-items-center rounded-full bg-[#D71920] px-1.5 text-xs font-black text-white ring-2 ring-white">
                  {cartCount}
                </span>
              ) : null}
            </Link>

            <button onClick={() => setMenuOpen((value) => !value)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-white shadow-sm lg:hidden" title="Menu">
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <div className="border-b border-neutral-200 bg-white/95">
          <div className="scrollbar-hide mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-2.5">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/categoria/${category.slug}`}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-extrabold uppercase tracking-wide transition ${view === "categoria" && route[1] === category.slug ? "border-[#D71920] bg-[#D71920] text-white shadow-sm" : "border-neutral-200 bg-[#F7F7F8] text-neutral-700 hover:border-[#D71920] hover:bg-white hover:text-[#D71920]"}`}
              >
                <Package className="h-3.5 w-3.5" /> {category.nombre}
              </Link>
            ))}
          </div>
        </div>

        {menuOpen ? (
          <div className="border-t border-neutral-100 bg-white px-4 py-3 shadow-xl lg:hidden">
            <div className="grid grid-cols-2 gap-2">
              <HeaderLink href="/catalogo" label="Catalogo" />
              <HeaderLink href="/catalogo?oferta=1" label="Ofertas" />
              <HeaderLink href="/#marcas" label="Marcas" />
              <HeaderLink href="/mi-cuenta/pedidos" label="Pedidos" />
              <HeaderLink href={user ? "/mi-cuenta" : "/login"} label={user ? "Mi cuenta" : "Ingresar"} />
            </div>
          </div>
        ) : null}
      </header>

      {notifications.filter((item) => item.tipo === "banner" || item.tipo === (view === "carrito" || view === "checkout" ? "aviso_carrito" : "aviso_home")).map((item) => (
        <div key={item.id} className="border-b border-red-100 bg-[#FFF5F5] px-4 py-3 text-sm text-neutral-800">
          <div className="mx-auto flex max-w-7xl items-start justify-between gap-4"><p><strong>{item.titulo}:</strong> {item.mensaje}</p><button title="Cerrar aviso" onClick={() => dismissNotification(item.id)}><X className="h-4 w-4" /></button></div>
        </div>
      ))}
      {notifications.find((item) => item.tipo === "popup") ? (() => { const item = notifications.find((entry) => entry.tipo === "popup")!; return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between gap-3"><h2 className="text-xl font-black">{item.titulo}</h2><button title="Cerrar" onClick={() => dismissNotification(item.id)}><X className="h-5 w-5" /></button></div><p className="mt-3 text-sm leading-6 text-neutral-600">{item.mensaje}</p></div></div>; })() : null}

      <main>
        {view === "login" || (view === "clientes" && route[1] === "login") ? <LoginView onUser={setUser} /> : null}
        {view === "registro" || (view === "clientes" && route[1] === "registro") ? <RegisterView onUser={setUser} /> : null}
        {view === "carrito" ? (
          <CartView cart={cart} total={cartTotal} user={user} banners={banners} onUpdate={updateCartItem} onRemove={removeCartItem} onClear={clearCart} />
        ) : null}
        {view === "checkout" ? <CheckoutView cart={cart} total={cartTotal} user={user} authReady={authReady} onClear={clearCart} /> : null}
        {view === "pedido-confirmado" ? <ConfirmedView order={order} /> : null}
        {view === "mi-cuenta" ? <AccountView user={user} orders={orders} order={order} route={route} /> : null}
        {view === "catalogo" && route[1] && product ? (
          <ProductDetail product={product} related={related} onAdd={addToCart} />
        ) : null}
        {["home", "catalogo", "categoria", "marca"].includes(view) || (view === "catalogo" && !route[1]) ? (
          <CatalogView
            view={view}
            route={route}
            loading={loading}
            products={products}
            categories={categories}
            brands={brands}
            banners={banners}
            pagination={pagination}
            error={catalogError}
            onAdd={addToCart}
            onHelp={() => setHelpOpen(true)}
          />
        ) : null}
      </main>

      {view === "home" ? <button onClick={() => setHelpOpen(true)} className="fixed bottom-5 right-5 z-30 rounded-full bg-[#D71920] px-5 py-3 text-sm font-black text-white shadow-xl">¿Como hacer un pedido?</button> : null}
      {helpOpen ? <OrderHelp onClose={() => setHelpOpen(false)} /> : null}

      <footer className="mt-16 bg-[#151515] text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <img src={LOGO_IMAGE} alt="Global Norte" className="mb-4 h-16 w-16 rounded-xl bg-white object-contain p-1" />
            <p className="max-w-md text-sm leading-6 text-neutral-300">Distribuidora mayorista para bodegas, tiendas y negocios en Lima Norte. Pedido online, PDF automatico y entrega coordinada.</p>
          </div>
          <div className="text-sm text-neutral-300">
            <p className="mb-3 font-black uppercase tracking-wide text-white">Contacto</p>
            <p>WhatsApp: {company.whatsappDisplay}</p>
            <p>Email: {company.email}</p>
            <a href={`https://wa.me/${company.whatsappNumber}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl bg-[#D71920] px-4 py-2 text-xs font-black uppercase text-white">Escribir por WhatsApp</a>
          </div>
          <div className="text-sm text-neutral-300">
            <p className="mb-3 font-black uppercase tracking-wide text-white">Empresa</p>
            <p>RUC 20608628461</p>
            <p>Carabayllo, Lima</p>
            <p>Entrega coordinada</p>
          </div>
          <div className="text-sm text-neutral-300">
            <p className="mb-3 font-black uppercase tracking-wide text-white">Links rapidos</p>
            <Link href="/catalogo" className="block py-1 hover:text-white">Catalogo</Link>
            <Link href="/mi-cuenta/pedidos" className="block py-1 hover:text-white">Mis pedidos</Link>
            <Link href="/login" className="block py-1 hover:text-white">Ingresar</Link>
            <p className="mt-5 text-xs text-neutral-500">Desarrollado por Fabrizio Apaza</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function OrderHelp({ onClose }: { onClose: () => void }) {
  const steps = ["Busca productos en el catalogo.", "Agrega las cantidades al carrito.", "Inicia sesion o crea tu cuenta mayorista.", "Completa direccion y Google Maps.", "Registra el pedido.", "Un asesor confirma disponibilidad y entrega."];
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label="Como hacer un pedido">
    <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-2xl font-black">¿Como hacer un pedido?</h2><button onClick={onClose} title="Cerrar"><X className="h-5 w-5" /></button></div><ol className="mt-5 grid gap-3">{steps.map((step, index) => <li key={step} className="flex gap-3 text-sm font-semibold text-neutral-700"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#D71920] text-xs font-black text-white">{index + 1}</span>{step}</li>)}</ol><div className="mt-6 flex justify-end"><Link href="/catalogo" onClick={onClose} className="rounded bg-[#D71920] px-5 py-3 text-sm font-black text-white">Empezar pedido</Link></div></div>
  </div>;
}

function HeaderLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex h-10 items-center rounded-xl border border-transparent px-3 text-sm font-extrabold text-neutral-700 transition hover:border-neutral-200 hover:bg-[#FFF5F5] hover:text-[#D71920]">
      {label}
    </Link>
  );
}

function Hero({ banner, onHelp }: { banner?: Banner; onHelp: () => void }) {
  const hasCustomImage = Boolean(banner?.imagenDesktop && banner.imagenDesktop !== LOGO_IMAGE);
  return (
    <section className="bg-[#F4F5F7] px-4 py-6">
      <div className="mx-auto grid max-w-7xl overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_82%_20%,rgba(255,255,255,0.28),transparent_28%),linear-gradient(135deg,#111111_0%,#D71920_48%,#F9FAFB_100%)] shadow-[0_24px_70px_rgba(17,17,17,0.18)] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="p-6 text-white sm:p-10 lg:p-12">
          <p className="mb-4 inline-flex rounded-full bg-white/15 px-4 py-2 text-xs font-black uppercase tracking-wide ring-1 ring-white/25">Mayorista B2B en Lima Norte</p>
          <h1 className="max-w-3xl text-4xl font-black leading-tight md:text-6xl">
            {banner?.titulo || "Precios mayoristas para bodegas y negocios"}
          </h1>
          <p className="mt-5 max-w-2xl text-base font-medium leading-7 text-white/90 md:text-lg">
            {banner?.descripcion || banner?.subtitulo || "Abarrotes, limpieza e higiene con pedido online y entrega coordinada en Lima Norte."}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={banner?.ctaLink || "/catalogo"} className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-[#D71920] shadow-lg transition hover:-translate-y-0.5">
              {banner?.ctaTexto || "Ver catalogo"} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/registro" className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/35 bg-black/20 px-5 text-sm font-black text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-black/30">
              Crear cuenta mayorista <Building2 className="h-4 w-4" />
            </Link>
            <button onClick={onHelp} className="inline-flex h-12 items-center rounded-2xl border border-white/35 px-5 text-sm font-black text-white">¿Como pedir?</button>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HeroMetric icon={<Package className="h-5 w-5" />} label="409 productos" />
            <HeroMetric icon={<ShieldCheck className="h-5 w-5" />} label="PDF automatico" />
            <HeroMetric icon={<BadgeCheck className="h-5 w-5" />} label="Pago al entregar" />
            <HeroMetric icon={<Phone className="h-5 w-5" />} label="Atencion por WhatsApp" />
          </div>
        </div>
        <div className="relative min-h-[340px] p-6 lg:p-10">
          <div className="absolute inset-x-10 bottom-8 h-24 rounded-[50%] bg-black/20 blur-2xl" />
          {hasCustomImage ? (
            <picture><source media="(max-width: 640px)" srcSet={imageSrc(banner?.imagenMobile || banner?.imagenDesktop)} /><img src={imageSrc(banner?.imagenDesktop)} onError={usePlaceholderImage} alt={banner?.titulo || "Banner Global Norte"} className="relative h-full min-h-[300px] w-full rounded-[26px] object-cover shadow-2xl" /></picture>
          ) : (
          <div className="relative ml-auto grid max-w-md gap-4 rounded-[26px] bg-white/95 p-5 shadow-2xl">
            <div className="flex items-center gap-4 rounded-2xl bg-[#151515] p-4 text-white">
              <img src={LOGO_IMAGE} alt="Global Norte" className="h-16 w-16 rounded-xl bg-white object-contain p-1" />
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-white/60">Distribuidora</p>
                <p className="text-2xl font-black">Global Norte</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {["Aceites", "Limpieza", "Higiene", "Abarrotes"].map((item) => (
                <div key={item} className="rounded-2xl border border-neutral-200 bg-[#F7F7F8] p-4">
                  <Package className="mb-4 h-6 w-6 text-[#D71920]" />
                  <p className="text-sm font-black">{item}</p>
                  <p className="text-xs font-semibold text-neutral-500">Stock mayorista</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-[#FFF5F5] p-4">
              <span className="text-sm font-black text-neutral-900">Pedido online</span>
              <span className="rounded-full bg-[#D71920] px-3 py-1 text-xs font-black text-white">PDF listo</span>
            </div>
          </div>
          )}
        </div>
      </div>
    </section>
  );
}

function HeroMetric({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/14 px-3 py-3 text-sm font-black text-white ring-1 ring-white/20 backdrop-blur">
      <span className="text-white">{icon}</span>
      {label}
    </div>
  );
}

function CampaignStrip({ banner }: { banner: Banner }) {
  return <section className="mx-auto max-w-7xl px-4 pt-5"><div className="grid overflow-hidden rounded-2xl bg-neutral-900 text-white sm:grid-cols-[1fr_260px]"><div className="p-5"><p className="text-xl font-black">{banner.titulo}</p><p className="mt-1 text-sm text-white/75">{banner.descripcion || banner.subtitulo}</p>{banner.ctaLink ? <Link href={banner.ctaLink} className="mt-3 inline-flex rounded bg-[#D71920] px-4 py-2 text-xs font-black uppercase">{banner.ctaTexto || "Ver mas"}</Link> : null}</div>{banner.imagenDesktop ? <picture><source media="(max-width: 640px)" srcSet={imageSrc(banner.imagenMobile || banner.imagenDesktop)} /><img src={imageSrc(banner.imagenDesktop)} alt={banner.titulo} className="h-full min-h-32 w-full object-cover" /></picture> : null}</div></section>;
}

function CatalogView({
  view,
  route,
  loading,
  products,
  categories,
  brands,
  banners,
  pagination,
  error,
  onAdd,
  onHelp,
}: {
  view: string;
  route: string[];
  loading: boolean;
  products: Product[];
  categories: Category[];
  brands: Brand[];
  banners: Banner[];
  pagination: { page: number; pages: number; total: number };
  error: string | null;
  onAdd: (productId: string, tipoPrecio?: string, cantidad?: number) => Promise<void>;
  onHelp: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchText, setSearchText] = useState(searchParams.get("q") ?? searchParams.get("search") ?? "");
  const title =
    view === "categoria"
      ? categories.find((category) => category.slug === route[1])?.nombre ?? "Categoria"
      : view === "marca"
        ? brands.find((brand) => brand.slug === route[1])?.nombre ?? "Marca"
        : view === "catalogo"
          ? "Catalogo mayorista"
          : "Productos destacados";

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) params.delete(key);
      else params.set(key, value);
    });
    if (!("page" in updates) && !("pagina" in updates)) params.set("page", "1");
    router.push(`/catalogo${params.toString() ? `?${params.toString()}` : ""}`);
  }

  useEffect(() => {
    if (view !== "catalogo") return;
    const timeout = window.setTimeout(() => {
      const current = searchParams.get("q") ?? "";
      if (searchText.trim() !== current) updateParams({ q: searchText.trim() || null });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchText, view]);

  const currentCategory = searchParams.get("category") ?? searchParams.get("categoria") ?? "";
  const currentBrand = searchParams.get("brand") ?? searchParams.get("marca") ?? "";
  const currentSort = searchParams.get("sort") ?? "";
  const currentPage = pagination.page;

  return (
    <>
      {view === "home" ? <Hero banner={banners.find((banner) => banner.posicion === "hero" || banner.tipo === "principal_home")} onHelp={onHelp} /> : null}
      {view === "catalogo" && banners.find((banner) => banner.tipo === "catalogo") ? <CampaignStrip banner={banners.find((banner) => banner.tipo === "catalogo")!} /> : null}
      <section className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-[#D71920]">{pagination.total || products.length} productos</p>
            <h2 className="text-3xl font-black tracking-tight text-neutral-950">{title}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterLink label="Disponibles" param="disponible" />
            <FilterLink label="Ofertas" param="oferta" />
            <FilterLink label="Nuevos" param="nuevo" />
          </div>
        </div>
        {view === "catalogo" ? (
          <div className="mb-6 grid gap-3 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:grid-cols-6">
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} className="h-11 rounded-2xl border border-neutral-200 bg-[#F7F7F8] px-4 text-sm font-medium outline-none focus:border-[#D71920] md:col-span-2" placeholder="Buscar nombre, codigo o marca" />
            <select value={currentCategory} onChange={(event) => updateParams({ category: event.target.value || null })} className="h-11 rounded-2xl border border-neutral-200 bg-[#F7F7F8] px-3 text-sm font-semibold">
              <option value="">Categoria</option>
              {categories.map((category) => <option key={category.id} value={category.slug}>{category.nombre}</option>)}
            </select>
            <select value={currentBrand} onChange={(event) => updateParams({ brand: event.target.value || null })} className="h-11 rounded-2xl border border-neutral-200 bg-[#F7F7F8] px-3 text-sm font-semibold">
              <option value="">Marca</option>
              {brands.map((brand) => <option key={brand.id} value={brand.slug}>{brand.nombre}</option>)}
            </select>
            <select value={currentSort} onChange={(event) => updateParams({ sort: event.target.value || null })} className="h-11 rounded-2xl border border-neutral-200 bg-[#F7F7F8] px-3 text-sm font-semibold">
              <option value="">Ordenar</option>
              <option value="nombre">Nombre</option>
              <option value="precio_asc">Precio menor</option>
              <option value="precio_desc">Precio mayor</option>
              <option value="recientes">Mas recientes</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input defaultValue={searchParams.get("minPrice") ?? ""} onBlur={(event) => updateParams({ minPrice: event.target.value || null })} className="h-11 rounded-2xl border border-neutral-200 bg-[#F7F7F8] px-3 text-sm" placeholder="Min" type="number" step="0.01" />
              <input defaultValue={searchParams.get("maxPrice") ?? ""} onBlur={(event) => updateParams({ maxPrice: event.target.value || null })} className="h-11 rounded-2xl border border-neutral-200 bg-[#F7F7F8] px-3 text-sm" placeholder="Max" type="number" step="0.01" />
            </div>
          </div>
        ) : null}
        {loading ? (
          <div className="flex min-h-60 items-center justify-center text-neutral-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando catalogo
          </div>
        ) : error ? (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded border border-neutral-200 bg-white p-8 text-center text-sm font-semibold text-neutral-600">
            No hay productos
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-5">
            {products.map((item) => (
              <ProductCard key={item.id} product={item} onAdd={onAdd} />
            ))}
          </div>
        )}
        {view !== "home" && pagination.pages > 1 ? (
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-600">
            <button disabled={currentPage <= 1} onClick={() => updateParams({ page: String(currentPage - 1) })} className="rounded border border-neutral-300 bg-white px-3 py-2 disabled:opacity-50">Anterior</button>
            {Array.from({ length: Math.min(5, pagination.pages) }, (_, index) => {
              const start = Math.max(1, Math.min(currentPage - 2, pagination.pages - 4));
              const page = start + index;
              return (
                <button key={page} onClick={() => updateParams({ page: String(page) })} className={`rounded border px-3 py-2 ${page === currentPage ? "border-[#D32F2F] bg-[#FFF5F5] text-[#D32F2F]" : "border-neutral-300 bg-white"}`}>
                  {page}
                </button>
              );
            })}
            <button disabled={currentPage >= pagination.pages} onClick={() => updateParams({ page: String(currentPage + 1) })} className="rounded border border-neutral-300 bg-white px-3 py-2 disabled:opacity-50">Siguiente</button>
            <span>Pagina {pagination.page} de {pagination.pages}</span>
          </div>
        ) : null}
      </section>
      {view === "home" ? (
        <section id="marcas" className="mx-auto max-w-7xl scroll-mt-48 px-4 py-8">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#D71920]">Catalogo mayorista</p>
              <h2 className="text-3xl font-black tracking-tight">Marcas disponibles</h2>
            </div>
            <Link href="/catalogo" className="hidden rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-black uppercase text-neutral-700 shadow-sm hover:border-[#D71920] hover:text-[#D71920] sm:inline-flex">Ver catalogo</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {brands.slice(0, 6).map((brand) => (
              <Link key={brand.id} href={`/marca/${brand.slug}`} className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm font-black text-neutral-900 shadow-sm transition hover:-translate-y-1 hover:border-[#D71920] hover:shadow-xl">
                <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-[#FFF5F5] text-[#D71920]"><Store className="h-5 w-5" /></span>
                {brand.nombre}
                <span className="mt-1 block text-xs font-semibold text-neutral-500">{brand._count?.products ?? 0} productos</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function FilterLink({ label, param }: { label: string; param: string }) {
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set(param, "1");
  return (
    <Link href={`/catalogo?${params.toString()}`} className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-neutral-700 shadow-sm transition hover:border-[#D71920] hover:text-[#D71920]">
      {label}
    </Link>
  );
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: (productId: string, tipoPrecio?: string, cantidad?: number) => Promise<void> }) {
  const [quantity, setQuantity] = useState(1);
  return (
    <article className="group overflow-hidden rounded-[20px] border border-neutral-200 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:border-[#D71920]/40 hover:shadow-xl">
      <Link href={`/catalogo/${product.slug}`} className="block bg-gradient-to-br from-white via-[#FAFAFA] to-[#F0F0F0] p-4">
        <ProductImage src={product.imagenPrincipal} alt={product.nombre} className="mx-auto aspect-square h-32 w-full max-w-40 object-contain transition duration-200 group-hover:scale-105 sm:h-36" loading="lazy" />
      </Link>
      <div className="p-3 sm:p-4">
        <div className="mb-2 flex min-h-6 flex-wrap gap-1.5">
          <span className="rounded-full bg-[#FFF5F5] px-2.5 py-1 text-[10px] font-black uppercase text-[#D71920]">{product.codigoInterno}</span>
          {product.etiquetaDestacada ? <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-[10px] font-black uppercase text-white">{product.etiquetaDestacada.replace("_", " ")}</span> : null}
          {product.stock <= product.stockMinimo ? <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-black uppercase text-orange-700">Stock bajo</span> : null}
        </div>
        <Link href={`/catalogo/${product.slug}`} className="line-clamp-2 min-h-10 text-[13px] font-black leading-5 text-neutral-950 hover:text-[#D71920] sm:text-sm">
          {product.nombre}
        </Link>
        <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-neutral-500">{product.brand?.nombre ?? product.category?.nombre}</p>
        <div className="mt-3 grid gap-2">
          <div>
            <p className="text-xl font-black tracking-tight text-[#D71920]">{money(product.precioUnitario)}</p>
            {product.precioCaja ? <p className="text-[11px] font-bold text-neutral-500">Caja {money(product.precioCaja)}</p> : null}
          </div>
          <div className="flex h-9 items-center justify-between overflow-hidden rounded-xl border border-neutral-200 bg-[#F7F7F8]">
            <button onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="h-full w-9 text-neutral-700 transition hover:bg-white" title="Restar"><Minus className="mx-auto h-4 w-4" /></button>
            <span className="text-sm font-black">{quantity}</span>
            <button onClick={() => setQuantity((value) => value + 1)} className="h-full w-9 text-neutral-700 transition hover:bg-white" title="Sumar"><Plus className="mx-auto h-4 w-4" /></button>
          </div>
        </div>
        <button onClick={() => onAdd(product.id, "unidad", quantity)} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#D71920] px-3 text-xs font-black uppercase tracking-wide text-white transition hover:bg-[#B51218]">
          <Plus className="h-4 w-4" /> Agregar al pedido
        </button>
      </div>
    </article>
  );
}

function ProductDetail({ product, related, onAdd }: { product: Product; related: Product[]; onAdd: (productId: string, tipoPrecio?: string, cantidad?: number) => Promise<void> }) {
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState("unidad");
  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid gap-8 lg:grid-cols-[520px_1fr]">
        <div className="aspect-square overflow-hidden rounded border border-neutral-200 bg-white">
          <ProductImage src={product.imagenPrincipal} alt={product.nombre} className="h-full w-full object-cover" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#D32F2F]">{product.codigoInterno}</p>
          <h1 className="mt-2 text-3xl font-extrabold text-neutral-950">{product.nombre}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-600">{product.descripcion}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Info label="Categoria" value={product.category?.nombre} />
            <Info label="Marca" value={product.brand?.nombre ?? "Global Norte"} />
            <Info label="Stock" value={`${product.stock} ${product.unidad}`} />
          </div>
          <div className="mt-6 rounded border border-neutral-200 bg-white p-4">
            <p className="text-3xl font-extrabold text-[#D32F2F]">{money(type === "caja" && product.precioCaja ? product.precioCaja : product.precioUnitario)}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <select value={type} onChange={(event) => setType(event.target.value)} className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm">
                <option value="unidad">Unidad</option>
                {product.precioCaja ? <option value="caja">Caja {product.etiquetaCaja ?? ""}</option> : null}
              </select>
              <div className="inline-flex h-11 overflow-hidden rounded border border-neutral-300 bg-white">
                <button onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="w-11 border-r border-neutral-200" title="Restar">
                  <Minus className="mx-auto h-4 w-4" />
                </button>
                <span className="grid w-14 place-items-center text-sm font-bold">{quantity}</span>
                <button onClick={() => setQuantity((value) => value + 1)} className="w-11 border-l border-neutral-200" title="Sumar">
                  <Plus className="mx-auto h-4 w-4" />
                </button>
              </div>
              <button onClick={() => onAdd(product.id, type, quantity)} className="inline-flex h-11 items-center gap-2 rounded bg-[#D32F2F] px-4 text-sm font-bold text-white hover:bg-[#B71C1C]">
                <ShoppingCart className="h-4 w-4" /> Agregar
              </button>
            </div>
          </div>
        </div>
      </div>
      {related.length ? (
        <div className="mt-10">
          <h2 className="mb-4 text-xl font-extrabold text-neutral-950">Relacionados</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-neutral-900">{value ?? "-"}</p>
    </div>
  );
}

function LoginView({ onUser }: { onUser: (user: User) => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await api<{ user: User }>("/api/customer/login", { method: "POST", body: JSON.stringify(formData(event)) });
      onUser(data.user);
      toast.success("Sesion iniciada");
      router.replace(searchParams.get("next") || "/mi-cuenta/pedidos");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar sesion";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <AuthShell title="Ingresar como cliente">
      <form onSubmit={submit} className="grid gap-3">
        <TextInput name="email" label="Email o telefono" required />
        <TextInput name="password" label="Password" type="password" required />
        {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        <button disabled={submitting} className="h-11 rounded bg-[#D32F2F] text-sm font-bold text-white hover:bg-[#B71C1C] disabled:opacity-60">{submitting ? "Ingresando" : "Ingresar"}</button>
        <Link href={`/registro${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next") as string)}` : ""}`} className="text-center text-sm font-bold text-[#D32F2F]">Crear cuenta</Link>
      </form>
    </AuthShell>
  );
}

function RegisterView({ onUser }: { onUser: (user: User) => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = formData(event);
      const data = await api<{ user: User }>("/api/customer/register", { method: "POST", body: JSON.stringify(payload) });
      onUser(data.user);
      toast.success("Cuenta creada");
      router.replace(searchParams.get("next") || "/checkout");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo crear la cuenta";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <AuthShell title="Registro de cliente">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <TextInput name="nombreNegocio" label="Nombre del negocio" required />
        <TextInput name="contacto" label="Nombre de contacto" required />
        <TextInput name="telefono" label="Telefono WhatsApp" required />
        <TextInput name="password" label="Password" type="password" minLength={6} required />
        <TextInput name="email" label="Email opcional" type="email" />
        <TextInput name="ruc" label="RUC/DNI opcional" />
        <TextInput name="direccion" label="Direccion" required />
        <TextInput name="referencia" label="Referencia" />
        <TextInput name="distrito" label="Distrito" />
        <div className="md:col-span-2">
          <CaptchaField />
        </div>
        {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 md:col-span-2">{error}</p> : null}
        <button disabled={submitting} className="h-11 rounded bg-[#D32F2F] text-sm font-bold text-white hover:bg-[#B71C1C] disabled:opacity-60 md:col-span-2">{submitting ? "Creando cuenta" : "Crear cuenta"}</button>
      </form>
    </AuthShell>
  );
}

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto flex max-w-xl items-center px-4 py-10">
      <div className="w-full rounded border border-neutral-200 bg-white p-6 shadow-sm">
        <img src={LOGO_IMAGE} alt="Global Norte" className="mx-auto mb-4 h-20 w-20 object-contain" />
        <h1 className="mb-5 text-center text-2xl font-extrabold text-neutral-950">{title}</h1>
        {children}
      </div>
    </section>
  );
}

function TextInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-neutral-700">
      {label}
      <input {...props} className="h-11 rounded border border-neutral-300 px-3 text-sm font-normal outline-none focus:border-[#D32F2F]" />
    </label>
  );
}

function CartView({ cart, total, user, banners, onUpdate, onRemove, onClear }: { cart: Cart | null; total: number; user: User | null; banners: Banner[]; onUpdate: (id: string, cantidad: number) => Promise<void>; onRemove: (id: string) => Promise<void>; onClear: () => void }) {
  const [couponCode, setCouponCode] = useState("");
  const [benefit, setBenefit] = useState<CommerceBenefit | null>(null);
  const [applying, setApplying] = useState(false);
  const cartKey = cart?.items.map((item) => `${item.product.id}:${item.cantidad}:${item.tipoPrecio}`).join("|") ?? "";
  const validate = useCallback(async (code: string, silent = false) => {
    if (!user || !cart?.items.length) return;
    setApplying(true);
    try {
      const data = await api<{ benefit: CommerceBenefit }>("/api/cupones/validar", { method: "POST", body: JSON.stringify({ couponCode: code, items: cart.items.map((item) => ({ productId: item.product.id, cantidad: item.cantidad, tipoPrecio: item.tipoPrecio })) }) });
      setBenefit(data.benefit);
      if (data.benefit.coupon?.code) window.localStorage.setItem(COUPON_STORAGE_KEY, data.benefit.coupon.code);
      if (!silent) toast.success(data.benefit.coupon ? "Cupon aplicado" : "Beneficios actualizados");
    } catch (error) { setBenefit(null); if (!silent) toast.error(error instanceof Error ? error.message : "Cupon invalido"); }
    finally { setApplying(false); }
  }, [cart, user]);
  useEffect(() => { const saved = window.localStorage.getItem(COUPON_STORAGE_KEY) || ""; setCouponCode(saved); if (user && cartKey) validate(saved, true); }, [cartKey, user, validate]);
  if (!cart?.items.length) return <EmptyState title="Carrito vacio" action="/catalogo" actionLabel="Ver catalogo" icon={<ShoppingCart className="h-8 w-8" />} />;
  const campaign = banners.find((banner) => banner.tipo === "carrito");
  return (<>
    {campaign ? <CampaignStrip banner={campaign} /> : null}
    <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[1fr_360px]">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold text-neutral-950">Pedido</h1>
          <button onClick={onClear} className="rounded border border-red-200 px-3 py-2 text-xs font-bold uppercase text-red-600">Vaciar carrito</button>
        </div>
        {cart.items.map((item) => (
          <div key={item.id} className="grid gap-3 rounded border border-neutral-200 bg-white p-4 sm:grid-cols-[88px_1fr_auto] sm:items-center">
            <ProductImage src={item.product.imagenPrincipal} alt={item.product.nombre} className="h-22 w-22 aspect-square rounded object-cover" />
            <div>
              <p className="text-sm font-extrabold text-neutral-950">{item.product.nombre}</p>
              <p className="text-xs text-neutral-500">{item.product.codigoInterno} - {item.tipoPrecio} - {money(itemPrice(item))}</p>
              <p className="text-xs font-bold text-neutral-700">Subtotal {money(itemPrice(item) * item.cantidad)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onUpdate(item.id, Math.max(1, item.cantidad - 1))} className="h-9 w-9 rounded border border-neutral-300" title="Restar"><Minus className="mx-auto h-4 w-4" /></button>
              <span className="w-8 text-center text-sm font-bold">{item.cantidad}</span>
              <button onClick={() => onUpdate(item.id, item.cantidad + 1)} className="h-9 w-9 rounded border border-neutral-300" title="Sumar"><Plus className="mx-auto h-4 w-4" /></button>
              <button onClick={() => onRemove(item.id)} className="h-9 w-9 rounded border border-red-200 text-red-600" title="Eliminar"><Trash2 className="mx-auto h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <aside className="h-fit rounded border border-neutral-200 bg-white p-5">
        <p className="text-sm font-bold uppercase tracking-wide text-neutral-500">Resumen del pedido</p>
        <div className="mt-4 flex justify-between text-sm"><span>Subtotal</span><strong>{money(total)}</strong></div>
        <div className="mt-2 flex justify-between text-sm"><span>Descuento</span><strong>-{money(benefit?.discount ?? 0)}</strong></div>
        {benefit?.coupon ? <p className="mt-2 text-xs font-bold text-green-700">Cupon {benefit.coupon.code}: {benefit.coupon.description}</p> : null}
        {benefit?.customerBenefit?.message ? <p className="mt-2 rounded bg-red-50 p-2 text-xs font-bold text-[#D71920]">Por ser cliente frecuente: {benefit.customerBenefit.message}</p> : null}
        {benefit?.bonuses.map((bonus, index) => <p key={`${bonus.name}-${index}`} className="mt-2 rounded bg-amber-50 p-2 text-xs font-bold text-amber-800">Te obsequiamos: {bonus.name} - S/ 0.00</p>)}
        <div className="mt-4 flex justify-between border-t border-neutral-200 pt-4 text-xl font-extrabold text-[#D32F2F]"><span>Total</span><span>{money(benefit?.total ?? total)}</span></div>
        <div className="mt-4 flex gap-2"><input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Ingresar cupon" className="h-10 min-w-0 flex-1 rounded border border-neutral-300 px-3 text-sm" /><button disabled={!user || applying} onClick={() => validate(couponCode)} className="rounded border border-[#D71920] px-3 text-xs font-black text-[#D71920] disabled:opacity-50">{applying ? "Validando" : "Aplicar"}</button></div>
        <Link href={user ? "/checkout" : "/login?next=%2Fcheckout"} className="mt-5 inline-flex h-11 w-full items-center justify-center rounded bg-[#D32F2F] text-sm font-bold text-white hover:bg-[#B71C1C]">
          {user ? "Finalizar pedido" : "Ingresar para finalizar"}
        </Link>
        <p className="mt-3 text-xs font-semibold leading-5 text-neutral-500">Completa tus datos para coordinar tu pedido. No es una compra confirmada; un asesor revisara disponibilidad y coordinara por WhatsApp.</p>
      </aside>
    </section></>
  );
}

function CheckoutView({ cart, total, user, authReady, onClear }: { cart: Cart | null; total: number; user: User | null; authReady: boolean; onClear: () => void }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [benefit, setBenefit] = useState<CommerceBenefit | null>(null);
  useEffect(() => {
    if (authReady && user === null) router.replace("/login?next=%2Fcheckout");
  }, [authReady, router, user]);
  useEffect(() => {
    if (!user || !cart?.items.length) return;
    const code = window.localStorage.getItem(COUPON_STORAGE_KEY) || "";
    setCouponCode(code);
    api<{ benefit: CommerceBenefit }>("/api/cupones/validar", { method: "POST", body: JSON.stringify({ couponCode: code, items: cart.items.map((item) => ({ productId: item.product.id, cantidad: item.cantidad, tipoPrecio: item.tipoPrecio })) }) }).then((data) => setBenefit(data.benefit)).catch(() => setBenefit(null));
  }, [user, cart]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      router.replace("/login?next=%2Fcheckout");
      return;
    }
    setSubmitting(true);
    const payload = {
      ...formData(event),
      couponCode,
      items: cart?.items.map((item): CartPayloadItem => ({ productId: item.product.id, cantidad: item.cantidad, tipoPrecio: item.tipoPrecio })) ?? [],
    };
    try {
      const data = await api<{ order: Order; waLink?: string }>("/api/orders", { method: "POST", body: JSON.stringify(payload) });
      toast.success("Pedido registrado. Un asesor confirmara disponibilidad y entrega.");
      onClear();
      window.localStorage.removeItem(COUPON_STORAGE_KEY);
      router.push(`/pedido-confirmado?id=${data.order.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo registrar el pedido";
      toast.error(message);
      if (message.toLowerCase().includes("sesion")) router.replace("/login?next=%2Fcheckout");
    } finally {
      setSubmitting(false);
    }
  }
  if (!cart?.items.length) return <EmptyState title="Carrito vacio" action="/catalogo" actionLabel="Ver catalogo" icon={<ShoppingCart className="h-8 w-8" />} />;
  if (!authReady) return <EmptyState title="Validando sesion" action="/carrito" actionLabel="Volver al carrito" icon={<Loader2 className="h-8 w-8 animate-spin" />} />;
  if (!user) return <EmptyState title="Inicia sesion para finalizar" action="/login?next=%2Fcheckout" actionLabel="Ingresar / Registrarse" icon={<UserRound className="h-8 w-8" />} />;
  return (
    <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[1fr_360px]">
      <form onSubmit={submit} className="rounded border border-neutral-200 bg-white p-5">
        <h1 className="mb-5 text-2xl font-extrabold text-neutral-950">Registrar pedido</h1>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput name="nombreNegocio" label="Nombre del negocio" defaultValue={user?.nombreNegocio ?? ""} />
          <TextInput name="contacto" label="Nombre de contacto" defaultValue={user ? `${user.nombre} ${user.apellido}` : ""} required />
          <TextInput name="dni" label="DNI/RUC opcional" defaultValue={user?.dni ?? user?.ruc ?? ""} />
          <TextInput name="telefono" label="Telefono WhatsApp" defaultValue={user?.telefono ?? ""} required />
          <TextInput name="direccion" label="Direccion" defaultValue={user?.direccion ?? ""} required />
          <TextInput name="referencia" label="Referencia" defaultValue={user?.referencia ?? ""} />
          <TextInput name="mapsUrl" label="Link de Google Maps" type="url" placeholder="https://maps.google.com/..." />
          <TextInput name="distrito" label="Distrito" defaultValue={user?.distrito ?? ""} />
          <TextInput name="email" label="Email opcional" type="email" defaultValue={user?.email ?? ""} />
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Metodo de entrega
            <select name="metodoEntrega" className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm font-normal">
              <option value="coordinada">Entrega coordinada</option>
              <option value="recojo">Recojo en tienda/local</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-neutral-700">
            Metodo de pago
            <select name="metodoPago" className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm font-normal">
              <option value="efectivo">Pago al entregar</option>
              <option value="yape">Yape/Plin</option>
              <option value="transferencia">Transferencia</option>
              <option value="plin">Plin</option>
            </select>
          </label>
        </div>
        <label className="mt-3 grid gap-1 text-sm font-semibold text-neutral-700">
          Observaciones
          <textarea name="notas" rows={4} className="rounded border border-neutral-300 px-3 py-2 text-sm font-normal outline-none focus:border-[#D32F2F]" />
        </label>
        <div className="mt-4">
          <CaptchaField />
        </div>
        <button disabled={submitting} className="mt-5 h-11 rounded bg-[#D32F2F] px-5 text-sm font-bold text-white hover:bg-[#B71C1C] disabled:opacity-60">
          {submitting ? "Registrando pedido" : "Registrar pedido"}
        </button>
      </form>
      <aside className="h-fit rounded border border-neutral-200 bg-white p-5">
        <p className="text-sm font-bold uppercase tracking-wide text-neutral-500">Total a pagar</p>
        <div className="mt-3 flex justify-between text-sm"><span>Subtotal</span><strong>{money(total)}</strong></div>
        <div className="mt-2 flex justify-between text-sm"><span>Descuento</span><strong>-{money(benefit?.discount ?? 0)}</strong></div>
        <p className="mt-3 text-3xl font-extrabold text-[#D32F2F]">{money(benefit?.total ?? total)}</p>
        {benefit?.coupon ? <p className="mt-2 text-xs font-bold text-green-700">Cupon aplicado: {benefit.coupon.code}</p> : null}
        {benefit?.bonuses.map((bonus, index) => <p key={`${bonus.name}-${index}`} className="mt-2 rounded bg-amber-50 p-2 text-xs font-bold text-amber-800">Bonificacion / regalo: {bonus.name} - S/ 0.00</p>)}
        <p className="mt-2 text-xs font-semibold text-neutral-500">Este documento no es comprobante de pago ni factura/boleta electronica.</p>
        <div className="mt-4 grid gap-2 text-sm text-neutral-600">
          {cart.items.map((item) => (
            <div key={item.id} className="flex justify-between gap-3">
              <span>{item.cantidad} x {item.product.nombre}</span>
              <strong>{money(itemPrice(item) * item.cantidad)}</strong>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}

function ConfirmedView({ order }: { order: Order | null }) {
  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <div className="rounded border border-neutral-200 bg-white p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
        <h1 className="mt-4 text-2xl font-extrabold text-neutral-950">Pedido registrado</h1>
        <p className="mt-2 text-sm font-semibold text-neutral-600">Un asesor confirmara disponibilidad y entrega.</p>
        {order ? (
          <>
            <p className="mt-2 text-neutral-600">{order.numero} - {money(order.total)}</p>
            <div className="mt-5 overflow-hidden rounded border border-neutral-200 text-left">
              <div className="bg-neutral-50 p-3 text-xs font-bold uppercase text-neutral-500">Recibo de pedido</div>
              {order.items.map((item) => (
                <div key={item.id} className="grid grid-cols-[1fr_auto] gap-2 border-t border-neutral-100 p-3 text-sm">
                  <span>{item.cantidad} x {item.nombre}</span>
                  <strong>{money(item.subtotal)}</strong>
                </div>
              ))}
              {order.cuponCodigo ? <div className="flex justify-between border-t border-neutral-100 p-3 text-sm text-green-700"><span>Cupon {order.cuponCodigo}</span><strong>-{money(order.descuento ?? 0)}</strong></div> : null}
              {(JSON.parse(order.bonificaciones || "[]") as Array<{ name?: string }>).map((bonus, index) => <div key={`${bonus.name}-${index}`} className="border-t border-neutral-100 p-3 text-sm font-bold text-amber-700">Bonificacion / regalo: {bonus.name} - S/ 0.00</div>)}
              <div className="flex justify-between border-t border-neutral-200 p-3 text-sm font-extrabold">
                <span>Total</span>
                <span>{money(order.total)}</span>
              </div>
            </div>
            <p className="mt-4 text-xs font-semibold text-neutral-500">
              Pedido sujeto a confirmacion de stock, precios y entrega. No es comprobante de pago.
            </p>
            {order.entregaMapsUrl ? <a href={order.entregaMapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-bold text-[#D71920]">Abrir ubicacion registrada</a> : null}
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {order.pdfUrl ? <a href={`/api/pdf/${order.id}`} target="_blank" className="inline-flex h-11 items-center gap-2 rounded border border-neutral-300 px-4 text-sm font-bold" rel="noreferrer"><ClipboardList className="h-4 w-4" /> Descargar PDF</a> : null}
              <button onClick={() => window.print()} className="inline-flex h-11 items-center rounded border border-neutral-300 px-4 text-sm font-bold">Imprimir</button>
              <Link href="/mi-cuenta/pedidos" className="inline-flex h-11 items-center rounded border border-neutral-300 px-4 text-sm font-bold">Ver mis pedidos</Link>
              <a href={`https://wa.me/${COMPANY.whatsappNumber}?text=${encodeURIComponent(`Hola Global Norte, deseo coordinar el pedido ${order.numero}. Total estimado: ${money(order.total)}`)}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded border border-green-300 px-4 text-sm font-bold text-green-700">Coordinar por WhatsApp</a>
              <Link href="/catalogo" className="inline-flex h-11 items-center rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">Seguir comprando</Link>
            </div>
          </>
        ) : (
          <p className="mt-2 text-neutral-600">Procesando informacion del pedido.</p>
        )}
      </div>
    </section>
  );
}

function AccountView({ user, orders, order, route }: { user: User | null; orders: Order[]; order: Order | null; route: string[] }) {
  if (!user) return <EmptyState title="Inicia sesion" action="/login" actionLabel="Ingresar" icon={<UserRound className="h-8 w-8" />} />;
  if (route[1] === "pedidos" && route[2] && order) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-extrabold text-neutral-950">{order.numero}</h1>
        <p className="mt-1 text-sm text-neutral-500">{stateLabel[order.estado] ?? order.estado} - {money(order.total)}</p>
        <div className="mt-5 overflow-hidden rounded border border-neutral-200 bg-white">
          {order.items.map((item) => (
            <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-neutral-100 p-4 text-sm">
              <span>{item.cantidad} x {item.nombre}</span>
              <strong>{money(item.subtotal)}</strong>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {order.pdfUrl ? <a href={`/api/pdf/${order.id}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded border border-neutral-300 px-4 text-sm font-bold">Descargar recibo PDF</a> : null}
          <button onClick={() => window.print()} className="inline-flex h-11 items-center rounded border border-neutral-300 px-4 text-sm font-bold">Imprimir</button>
        </div>
      </section>
    );
  }
  if (route[1] === "pedidos") {
    return (
      <section className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-5 text-2xl font-extrabold text-neutral-950">Mis pedidos</h1>
        <div className="grid gap-3">
          {orders.map((item) => (
            <Link key={item.id} href={`/mi-cuenta/pedidos/${item.id}`} className="grid gap-2 rounded border border-neutral-200 bg-white p-4 text-sm hover:border-[#D32F2F] md:grid-cols-[1fr_auto_auto]">
              <strong>{item.numero}</strong>
              <span>{stateLabel[item.estado] ?? item.estado}</span>
              <span className="font-extrabold text-[#D32F2F]">{money(item.total)}</span>
            </Link>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-5 text-2xl font-extrabold text-neutral-950">Mi cuenta</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Info label="Cliente" value={`${user.nombre} ${user.apellido}`} />
        <Info label="Email" value={user.email} />
        <Info label="Telefono" value={user.telefono} />
        <Info label="Negocio" value={user.nombreNegocio ?? "-"} />
        <Info label="Distrito" value={user.distrito ?? "-"} />
        <Info label="Direccion" value={user.direccion ?? "-"} />
      </div>
    </section>
  );
}

function EmptyState({ title, action, actionLabel, icon }: { title: string; action: string; actionLabel: string; icon: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="rounded border border-neutral-200 bg-white p-8">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#FFF5F5] text-[#D32F2F]">{icon}</div>
        <h1 className="mt-4 text-2xl font-extrabold text-neutral-950">{title}</h1>
        <Link href={action} className="mt-5 inline-flex h-11 items-center rounded bg-[#D32F2F] px-4 text-sm font-bold text-white">{actionLabel}</Link>
      </div>
    </section>
  );
}

function CaptchaField() {
  const [token, setToken] = useState(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ? "" : "dev-captcha");
  const siteKey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  return (
    <div>
      <input type="hidden" name="captchaToken" value={token} />
      {siteKey ? <HCaptcha sitekey={siteKey} onVerify={setToken} onExpire={() => setToken("")} /> : null}
    </div>
  );
}
