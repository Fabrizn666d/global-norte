import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const baseURL = "http://localhost:3001";
const adminEmail = "admin@globalnorte.pe";
const envText = fs.existsSync(path.join(process.cwd(), ".env")) ? fs.readFileSync(path.join(process.cwd(), ".env"), "utf8") : "";
function envValue(key: string) {
  return process.env[key] ?? envText.match(new RegExp(`^${key}=["']?([^"'\r\n]+)`, "m"))?.[1] ?? "";
}
const adminPassword = envValue("ADMIN_TEST_PASSWORD") || envValue("ADMIN_SEED_PASSWORD");
if (!adminPassword) throw new Error("Define ADMIN_TEST_PASSWORD o ADMIN_SEED_PASSWORD para ejecutar UI QA.");

const uploadImage = path.join(process.cwd(), "public", "brand", "global-norte-logo.jpg");

test("cliente crea pedido y admin lo gestiona", async ({ page }) => {
  const phone = `9${Date.now().toString().slice(-8)}`;
  await page.goto(`${baseURL}/catalogo`, { waitUntil: "networkidle" });
  await expect(page.getByText("Cargando catalogo")).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByText("Catalogo mayorista")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(24);
  await expect(page.getByText("Pagina 1 de")).toBeVisible();

  await page.getByPlaceholder("Buscar nombre, codigo o marca").fill("ACEITE");
  await expect(page.locator("article").first()).toContainText(/ACEITE/i, { timeout: 20000 });

  await page.locator("article").nth(0).getByRole("button", { name: "Sumar" }).click();
  await page.locator("article").nth(0).getByRole("button", { name: "Sumar" }).click();
  await page.locator("article").nth(0).getByRole("button", { name: "Agregar al pedido" }).click();
  await page.locator("article").nth(1).getByRole("button", { name: "Agregar al pedido" }).click();
  await page.locator("article").nth(2).getByRole("button", { name: "Agregar al pedido" }).click();

  await page.goto(`${baseURL}/carrito`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Pedido" })).toBeVisible();
  await expect(page.getByText("Resumen del pedido")).toBeVisible();
  await page.locator("button[title='Sumar']").first().click();
  await expect(page.getByText("Ingresar para finalizar")).toBeVisible();

  await page.goto(`${baseURL}/checkout`, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/login\?next=%2Fcheckout/, { timeout: 20000 });
  await expect(page.getByRole("heading", { name: "Ingresar como cliente" })).toBeVisible();
  await page.getByRole("link", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Registro de cliente" })).toBeVisible();
  await page.getByLabel("Nombre del negocio").fill("Bodega UI Codex");
  await page.getByLabel("Nombre de contacto").fill("Cliente Prueba UI");
  await page.getByLabel("Telefono WhatsApp").fill(phone);
  await page.getByLabel("Password").fill("cliente123");
  await page.getByLabel("Direccion").fill("Av. Prueba 123");
  await page.getByLabel("Referencia").fill("Frente al parque");
  await page.getByLabel("Distrito").fill("Carabayllo");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/checkout/, { timeout: 20000 });
  await expect(page.getByText("Bodega UI Codex")).toBeVisible({ timeout: 20000 });
  const orderResponsePromise = page.waitForResponse((response) => response.url().includes("/api/orders") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  const orderResponse = await orderResponsePromise;
  const orderResponseText = await orderResponse.text();
  expect(orderResponse.ok(), orderResponseText).toBeTruthy();

  await expect(page.getByRole("heading", { name: "Pedido registrado" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/GN-\d{4}-\d+/)).toBeVisible({ timeout: 20000 });
  const orderText = await page.locator("body").innerText();
  const orderNumber = orderText.match(/GN-\d{4}-\d+/)?.[0];
  expect(orderNumber).toBeTruthy();
  await expect(page.getByText("No es comprobante de pago")).toBeVisible();
  await expect(page.getByText("Ver mis pedidos")).toBeVisible();
  const clientPdfHref = await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
  expect(clientPdfHref).toBeTruthy();
  const clientPdf = await page.request.get(`${baseURL}${clientPdfHref}`);
  expect(clientPdf.ok()).toBeTruthy();
  expect(clientPdf.headers()["content-type"]).toContain("application/pdf");

  await page.goto(`${baseURL}/admin`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20000 });

  await page.goto(`${baseURL}/admin/pedidos`, { waitUntil: "networkidle" });
  await expect(page.getByText(orderNumber as string)).toBeVisible({ timeout: 20000 });
  await page.locator("tr", { hasText: orderNumber as string }).getByRole("link", { name: "Ver" }).click();
  await expect(page.getByText(`Proforma ${orderNumber}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "PDF proforma" })).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp interno" })).toHaveAttribute("href", /wa\.me\/51918171484/);
  const adminPdfHref = await page.getByRole("link", { name: "PDF proforma" }).getAttribute("href");
  const adminPdf = await page.request.get(`${baseURL}${adminPdfHref}`);
  expect(adminPdf.ok()).toBeTruthy();
  expect(adminPdf.headers()["content-type"]).toContain("application/pdf");
  await page.getByRole("button", { name: "Confirmado" }).click();
  await expect(page.getByRole("button", { name: "Confirmado" })).toHaveClass(/D32F2F/);
});

test("admin productos e imagenes y banners funcionan", async ({ page }) => {
  page.on("dialog", async (dialog) => dialog.accept());
  const productCode = `UITEST-${Date.now()}`;

  await page.goto(`${baseURL}/admin`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20000 });

  await page.goto(`${baseURL}/admin/productos`, { waitUntil: "networkidle" });
  await expect(page.getByText("Pagina 1 de")).toBeVisible();
  await page.getByLabel("Codigo interno").fill(productCode);
  await page.getByLabel("Nombre").fill("Producto temporal UI Codex");
  await page.getByLabel("P. unitario").fill("2.50");
  await page.locator("input[name='stock']").fill("5");
  await page.locator("input[name='stockMinimo']").fill("1");
  await page.locator("input[name='unidad']").fill("unidad");
  await page.getByLabel("Subir imagen").setInputFiles(uploadImage);
  await expect(page.getByLabel("Imagen principal")).toHaveValue(/\/uploads\/products\//, { timeout: 20000 });
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await page.getByPlaceholder("Buscar codigo, nombre o marca").fill(productCode);
  await expect(page.getByText(productCode)).toBeVisible({ timeout: 20000 });
  await page.goto(`${baseURL}/catalogo?q=${encodeURIComponent(productCode)}`, { waitUntil: "networkidle" });
  await expect(page.locator("article", { hasText: productCode })).toBeVisible({ timeout: 20000 });
  await expect(page.locator("article", { hasText: productCode }).locator("img")).toHaveAttribute("src", /\/api\/media\/uploads\/products\//);
  await page.goto(`${baseURL}/admin/productos`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Buscar codigo, nombre o marca").fill(productCode);
  await page.locator("tr", { hasText: productCode }).getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Nombre").fill("Producto temporal UI Codex editado");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText("Producto temporal UI Codex editado")).toBeVisible({ timeout: 20000 });
  await page.locator("tr", { hasText: productCode }).getByRole("button", { name: "Eliminar" }).click();
  await expect(page.getByText(productCode)).toHaveCount(0, { timeout: 20000 });

  await page.goto(`${baseURL}/admin/banners`, { waitUntil: "networkidle" });
  const bannerTitle = `Banner UI ${Date.now()}`;
  await page.getByLabel("Titulo", { exact: true }).fill(bannerTitle);
  await page.getByLabel("Subtitulo").fill("Oferta mayorista");
  await page.getByLabel("Subir imagen").setInputFiles(uploadImage);
  await expect(page.getByLabel("Imagen", { exact: true })).toHaveValue(/\/uploads\/banners\//, { timeout: 20000 });
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(bannerTitle)).toBeVisible({ timeout: 20000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: bannerTitle })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.goto(`${baseURL}/admin/banners`, { waitUntil: "networkidle" });
  await page.locator("tr", { hasText: bannerTitle }).getByRole("button", { name: "Editar" }).click();
  const editedTitle = `${bannerTitle} editado`;
  await page.getByLabel("Titulo", { exact: true }).fill(editedTitle);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(editedTitle)).toBeVisible({ timeout: 20000 });
  await page.locator("tr", { hasText: editedTitle }).getByRole("button", { name: "Desactivar" }).click();
  await page.locator("tr", { hasText: editedTitle }).getByRole("button", { name: "Eliminar" }).click();
  await expect(page.getByText(editedTitle)).toHaveCount(0, { timeout: 20000 });

  const suffix = Date.now();
  for (const [route, label] of [["categorias", `Categoria UI ${suffix}`], ["marcas", `Marca UI ${suffix}`]] as const) {
    await page.goto(`${baseURL}/admin/${route}`, { waitUntil: "networkidle" });
    await page.getByLabel("Nombre").fill(label);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(label)).toBeVisible({ timeout: 20000 });
    await page.locator("tr", { hasText: label }).getByRole("button", { name: "Editar" }).click();
    const edited = `${label} editada`;
    await page.getByLabel("Nombre").fill(edited);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(edited)).toBeVisible({ timeout: 20000 });
    await page.locator("tr", { hasText: edited }).getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByText(edited)).toHaveCount(0, { timeout: 20000 });
  }

  await page.goto(`${baseURL}/admin/configuracion`, { waitUntil: "networkidle" });
  await expect(page.getByLabel("WhatsApp", { exact: true })).toHaveValue("51918171484");
  await expect(page.getByLabel("Telefono", { exact: true })).toHaveValue("918 171 484");
  await page.getByRole("button", { name: "Guardar configuracion" }).click();
  await expect(page.getByText("Configuracion guardada")).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Cerrar sesion" }).click();
  await expect(page.getByRole("heading", { name: "Global Norte - Panel Admin" })).toBeVisible({ timeout: 20000 });
});
