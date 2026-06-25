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
  await page.getByLabel("Mostrar en home").check();
  await page.getByLabel("Destacado", { exact: true }).check();
  await page.getByLabel("Orden en home").fill("0");
  await page.getByLabel("Etiqueta destacada").selectOption("recomendado");
  await page.getByLabel("Subir imagen").setInputFiles(uploadImage);
  await expect(page.getByLabel("Imagen principal")).toHaveValue(/\/uploads\/products\//, { timeout: 20000 });
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await page.getByPlaceholder("Buscar codigo, nombre o marca").fill(productCode);
  await expect(page.getByText(productCode)).toBeVisible({ timeout: 20000 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.locator("article", { hasText: productCode })).toBeVisible({ timeout: 20000 });
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
  await page.getByLabel("Inicio programado").fill("2026-01-01T00:00");
  await page.getByLabel("Fin programado").fill("2026-12-31T23:59");
  await page.getByLabel("Subir imagen").setInputFiles(uploadImage);
  await page.getByLabel("Cargar archivo movil").setInputFiles(uploadImage);
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

test("cupones, bonificaciones, notificaciones y consolidado funcionan", async ({ page }) => {
  page.on("dialog", async (dialog) => dialog.accept());
  const suffix = Date.now();
  const phone = `9${suffix.toString().slice(-8)}`;

  await page.goto(`${baseURL}/catalogo?q=ACEITE`, { waitUntil: "networkidle" });
  const card = page.locator("article").first();
  await expect(card).toContainText(/ACEITE/i);
  for (let index = 0; index < 29; index += 1) await card.getByRole("button", { name: "Sumar" }).click();
  await card.getByRole("button", { name: "Agregar al pedido" }).click();
  await page.goto(`${baseURL}/registro?next=%2Fcarrito`, { waitUntil: "networkidle" });
  await page.getByLabel("Nombre del negocio").fill(`Bodega Beneficios QA ${suffix}`);
  await page.getByLabel("Nombre de contacto").fill("Cliente Beneficios QA");
  await page.getByLabel("Telefono WhatsApp").fill(phone);
  await page.getByLabel("Password").fill("cliente123");
  await page.getByLabel("Direccion").fill("Av. QA 456");
  await page.getByLabel("Referencia").fill("Puerta roja");
  await page.getByLabel("Distrito").fill("Carabayllo");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/carrito/, { timeout: 20000 });
  await expect(page.getByTitle("Mi cuenta")).toBeVisible({ timeout: 20000 });
  await page.getByPlaceholder("Ingresar cupon").fill("BODEGA10");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText(/Cupon BODEGA10/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Te obsequiamos: Regalo mayorista/)).toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Finalizar pedido" }).click();
  await page.getByLabel("Link de Google Maps").fill("https://maps.google.com/?q=-11.9,-77.0");
  const orderResponsePromise = page.waitForResponse((response) => response.url().includes("/api/orders") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.ok(), await orderResponse.text()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Pedido registrado" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Cupon BODEGA10/)).toBeVisible();
  await expect(page.getByText(/Bonificacion \/ regalo/)).toBeVisible();

  await page.goto(`${baseURL}/admin`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20000 });

  await page.goto(`${baseURL}/admin/consolidado`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Consolidado de carga", level: 1 })).toBeVisible();
  await expect(page.getByText("ACEITE ALPA DE 1LT")).toBeVisible({ timeout: 20000 });
  const pdfHref = await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
  const csvHref = await page.getByRole("link", { name: "Exportar CSV / Excel" }).getAttribute("href");
  const consolidatedPdf = await page.request.get(`${baseURL}${pdfHref}`);
  const consolidatedCsv = await page.request.get(`${baseURL}${csvHref}`);
  expect(consolidatedPdf.headers()["content-type"]).toContain("application/pdf");
  expect(consolidatedCsv.headers()["content-type"]).toContain("text/csv");

  await page.goto(`${baseURL}/admin/backups`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Backups", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Backup DB" }).click();
  await expect(page.getByText("global-norte-database")).toBeVisible({ timeout: 30000 });
  const dbBackupHref = await page.locator("tr", { hasText: "global-norte-database" }).first().getByRole("link", { name: "Descargar" }).getAttribute("href");
  const dbBackup = await page.request.get(`${baseURL}${dbBackupHref}`);
  expect(dbBackup.ok()).toBeTruthy();
  expect(dbBackup.headers()["content-type"]).toContain("application/x-sqlite3");
  await page.getByRole("button", { name: "Backup uploads" }).click();
  await expect(page.getByText("global-norte-uploads")).toBeVisible({ timeout: 30000 });
  const uploadsBackupHref = await page.locator("tr", { hasText: "global-norte-uploads" }).first().getByRole("link", { name: "Descargar" }).getAttribute("href");
  const uploadsBackup = await page.request.get(`${baseURL}${uploadsBackupHref}`);
  expect(uploadsBackup.ok()).toBeTruthy();
  expect(uploadsBackup.headers()["content-type"]).toContain("application/zip");

  const couponCode = `QA${suffix}`;
  await page.goto(`${baseURL}/admin/cupones`, { waitUntil: "networkidle" });
  await page.getByLabel("Codigo").fill(couponCode);
  await page.getByLabel("Descripcion").fill("Cupon QA");
  await page.getByLabel("Monto o porcentaje").fill("5");
  await page.getByLabel("Carrito minimo").fill("10");
  await page.getByLabel("Activo", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar cupon" }).click();
  await expect(page.getByText(couponCode)).toBeVisible();
  await page.locator("tr", { hasText: couponCode }).getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Descripcion").fill("Cupon QA editado");
  await page.getByLabel("Activo", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Guardar cupon" }).click();
  await expect(page.locator("tr", { hasText: couponCode })).toContainText("false");

  const bonusName = `Bonificacion QA ${suffix}`;
  await page.goto(`${baseURL}/admin/bonificaciones`, { waitUntil: "networkidle" });
  await page.getByLabel("Nombre", { exact: true }).fill(bonusName);
  await page.getByLabel("Producto gratis / beneficio").fill("Muestra QA");
  await page.getByLabel("Valor condicion").fill("10");
  await page.getByLabel("Activa", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(bonusName)).toBeVisible();
  await page.locator("tr", { hasText: bonusName }).getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Producto gratis / beneficio").fill("Muestra QA editada");
  await page.getByLabel("Activa", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("tr", { hasText: bonusName })).toContainText("false");

  const notificationTitle = `Aviso QA ${suffix}`;
  await page.goto(`${baseURL}/admin/notificaciones`, { waitUntil: "networkidle" });
  await page.getByLabel("Titulo").fill(notificationTitle);
  await page.getByLabel("Mensaje").fill("Hola {nombre}, promocion QA");
  await page.getByLabel("Activa", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(notificationTitle)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesion" }).click();
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await expect(page.getByText(notificationTitle)).toBeVisible({ timeout: 20000 });
});
