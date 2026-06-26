import fs from "node:fs";
import path from "node:path";
import { expect, Page, test } from "@playwright/test";

const baseURL = "http://localhost:3001";
const adminEmail = "admin@globalnorte.pe";
const adminPassword = "GlobalNorte2026!";
const uploadImage = path.join(process.cwd(), "public", "brand", "global-norte-logo.jpg");
const artifactPath = path.join(process.cwd(), "test-results", "day-simulation-artifact.json");

async function closeBlockingNotices(page: Page) {
  await page.locator('.fixed.inset-0.z-50 button[title="Cerrar"]').first().click({ timeout: 2500, force: true }).catch(() => undefined);
}

async function adminLogin(page: Page) {
  await page.goto(`${baseURL}/admin`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20000 });
}

test("DAYQA uso real completo de Global Norte", async ({ page }) => {
  test.setTimeout(180000);
  page.on("dialog", async (dialog) => dialog.accept());
  const suffix = Date.now();
  const phoneGuest = `98${suffix.toString().slice(-7)}`;
  const phoneRegistered = `97${suffix.toString().slice(-7)}`;
  const productCode = `DAYQA-${suffix}`;
  const bannerTitle = `DAYQA Banner ${suffix}`;
  const notificationTitle = `DAYQA Notificacion ${suffix}`;
  const couponCode = `DAYQA${suffix.toString().slice(-6)}`;
  const bonusName = `DAYQA Bonificacion ${suffix}`;
  const adminAccount = `dayqa.admin.${suffix}@globalnorte.test`;

  await page.goto(`${baseURL}/catalogo`, { waitUntil: "networkidle" });
  await closeBlockingNotices(page);
  await expect(page.getByText("Catalogo mayorista")).toBeVisible();
  await page.getByPlaceholder("Buscar nombre, codigo o marca").fill("ACEITE");
  await expect(page.locator("article").first()).toContainText(/ACEITE/i, { timeout: 20000 });
  await closeBlockingNotices(page);
  await page.locator("article").nth(0).getByRole("button", { name: "Sumar" }).click();
  await page.locator("article").nth(0).getByRole("button", { name: "Agregar al pedido" }).click();
  await page.locator("article").nth(1).getByRole("button", { name: "Agregar al pedido" }).click();

  await page.goto(`${baseURL}/carrito`, { waitUntil: "networkidle" });
  await expect(page.getByText("Continuar como invitado")).toBeVisible();
  for (let index = 0; index < 13; index += 1) {
    await page.locator("button[title='Sumar']").first().click();
  }
  await expect(page.locator("body")).toContainText("S/ 108", { timeout: 5000 });
  await page.getByPlaceholder("Ingresar cupon").fill("BODEGA10");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText(/Cupon BODEGA10/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Te obsequiamos/).first()).toBeVisible({ timeout: 20000 });

  await page.goto(`${baseURL}/checkout`, { waitUntil: "networkidle" });
  await page.getByLabel("Nombre del negocio").fill(`DAYQA Bodega Invitada ${suffix}`);
  await page.getByLabel("Nombre", { exact: true }).fill("Cliente Invitado DAYQA");
  await page.getByLabel("Celular").fill(phoneGuest);
  await page.getByLabel("Direccion").fill("Av. DAYQA Invitado 123");
  await page.getByLabel("Referencia").fill("Referencia DAYQA");
  await page.getByLabel("Distrito").fill("Carabayllo");
  await page.getByLabel("Link de Google Maps").fill("https://maps.google.com/?q=-11.9,-77.0");
  const guestOrderResponsePromise = page.waitForResponse((response) => response.url().includes("/api/orders") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  const guestOrderResponse = await guestOrderResponsePromise;
  expect(guestOrderResponse.ok(), await guestOrderResponse.text()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Pedido registrado" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/GN-\d{4}-\d+/)).toBeVisible({ timeout: 20000 });
  const guestText = await page.locator("body").innerText();
  const guestOrder = guestText.match(/GN-\d{4}-\d+/)?.[0] ?? "";
  expect(guestOrder).toBeTruthy();
  const guestPdfHref = await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
  expect((await page.request.get(`${baseURL}${guestPdfHref}`)).headers()["content-type"]).toContain("application/pdf");

  await page.goto(`${baseURL}/catalogo?q=ACEITE`, { waitUntil: "networkidle" });
  await closeBlockingNotices(page);
  await page.locator("article").first().getByRole("button", { name: "Agregar al pedido" }).click();
  await page.goto(`${baseURL}/registro?next=%2Fcheckout`, { waitUntil: "networkidle" });
  await page.getByLabel("Nombre del negocio").fill(`DAYQA Bodega Registrada ${suffix}`);
  await page.getByLabel("Nombre de contacto").fill("Cliente Registrado DAYQA");
  await page.getByLabel("Telefono WhatsApp").fill(phoneRegistered);
  await page.getByLabel("Password").fill("cliente123");
  await page.getByLabel("Direccion").fill("Av. DAYQA Registrado 456");
  await page.getByLabel("Referencia").fill("Referencia registrada DAYQA");
  await page.getByLabel("Distrito").fill("Comas");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/checkout/, { timeout: 20000 });
  await page.getByLabel("Link de Google Maps").fill("https://maps.google.com/?q=-11.95,-77.05");
  const registeredOrderResponsePromise = page.waitForResponse((response) => response.url().includes("/api/orders") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  const registeredOrderResponse = await registeredOrderResponsePromise;
  expect(registeredOrderResponse.ok(), await registeredOrderResponse.text()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Pedido registrado" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/GN-\d{4}-\d+/)).toBeVisible({ timeout: 20000 });
  const registeredText = await page.locator("body").innerText();
  const registeredOrder = registeredText.match(/GN-\d{4}-\d+/)?.[0] ?? "";
  expect(registeredOrder).toBeTruthy();

  await adminLogin(page);
  await page.goto(`${baseURL}/admin/pedidos`, { waitUntil: "networkidle" });
  await expect(page.locator("body")).toContainText(guestOrder, { timeout: 20000 });
  await page.locator("tr", { hasText: guestOrder }).getByRole("link", { name: "Ver" }).click();
  await expect(page.getByText(`Proforma ${guestOrder}`)).toBeVisible();
  await page.getByRole("button", { name: "Confirmado" }).click();
  const adminPdfHref = await page.getByRole("link", { name: "PDF proforma" }).getAttribute("href");
  expect((await page.request.get(`${baseURL}${adminPdfHref}`)).headers()["content-type"]).toContain("application/pdf");

  await page.goto(`${baseURL}/admin/consolidado`, { waitUntil: "networkidle" });
  const consolidatedPdfHref = await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
  const consolidatedCsvHref = await page.getByRole("link", { name: "Exportar CSV / Excel" }).getAttribute("href");
  expect((await page.request.get(`${baseURL}${consolidatedPdfHref}`)).headers()["content-type"]).toContain("application/pdf");
  expect((await page.request.get(`${baseURL}${consolidatedCsvHref}`)).headers()["content-type"]).toContain("text/csv");

  await page.goto(`${baseURL}/admin/productos`, { waitUntil: "networkidle" });
  await page.getByLabel("Codigo interno").fill(productCode);
  await page.getByLabel("Nombre").fill(`DAYQA Producto ${suffix}`);
  await page.getByLabel("P. unitario").fill("9.90");
  await page.locator("input[name='unidad']").fill("unidad");
  await page.getByLabel("Mostrar en home").check();
  await page.getByLabel("Destacado", { exact: true }).check();
  await page.getByLabel("Oferta", { exact: true }).check();
  await page.getByLabel("Nuevo", { exact: true }).check();
  await page.getByLabel("Subir imagen").setInputFiles(uploadImage);
  await expect(page.getByLabel("Imagen principal")).toHaveValue(/\/uploads\/products\//, { timeout: 20000 });
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await page.getByPlaceholder("Buscar codigo, nombre o marca").fill(productCode);
  await expect(page.locator("body")).toContainText(productCode, { timeout: 20000 });
  await page.locator("tr", { hasText: productCode }).getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Nombre").fill(`DAYQA Producto Editado ${suffix}`);
  await page.getByLabel("Disponible / Sin stock").check();
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await page.goto(`${baseURL}/catalogo?q=${encodeURIComponent(productCode)}`, { waitUntil: "networkidle" });
  await expect(page.locator("article", { hasText: productCode })).toContainText("Sin stock", { timeout: 20000 });
  await expect(page.locator("article", { hasText: productCode })).toContainText("Nuevo");

  await page.goto(`${baseURL}/admin/banners`, { waitUntil: "networkidle" });
  await page.getByLabel("Titulo", { exact: true }).fill(bannerTitle);
  await page.getByLabel("Subtitulo").fill("DAYQA oferta mayorista");
  await page.getByLabel("Inicio programado").fill("2026-01-01T00:00");
  await page.getByLabel("Fin programado").fill("2026-12-31T23:59");
  await page.getByLabel("Subir imagen").setInputFiles(uploadImage);
  await page.getByLabel("Cargar archivo movil").setInputFiles(uploadImage);
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("body")).toContainText(bannerTitle, { timeout: 20000 });

  await page.goto(`${baseURL}/admin/notificaciones`, { waitUntil: "networkidle" });
  await page.getByLabel("Titulo").fill(notificationTitle);
  await page.getByLabel("Mensaje").fill("DAYQA aviso operativo");
  await page.getByLabel("Activa", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("body")).toContainText(notificationTitle, { timeout: 20000 });

  await page.goto(`${baseURL}/admin/cupones`, { waitUntil: "networkidle" });
  await page.getByLabel("Codigo").fill(couponCode);
  await page.getByLabel("Descripcion").fill("DAYQA cupon operativo");
  await page.getByLabel("Monto o porcentaje").fill("3");
  await page.getByLabel("Carrito minimo").fill("5");
  await page.getByLabel("Activo", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar cupon" }).click();
  await expect(page.locator("body")).toContainText(couponCode, { timeout: 20000 });

  await page.goto(`${baseURL}/admin/bonificaciones`, { waitUntil: "networkidle" });
  await page.getByLabel("Nombre", { exact: true }).fill(bonusName);
  await page.getByLabel("Producto gratis / beneficio").fill("DAYQA muestra gratis");
  await page.getByLabel("Valor condicion").fill("5");
  await page.getByLabel("Activa", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator("body")).toContainText(bonusName, { timeout: 20000 });

  await page.goto(`${baseURL}/admin/administradores`, { waitUntil: "networkidle" });
  await page.getByLabel("Nombre").fill(`DAYQA Admin ${suffix}`);
  await page.getByLabel("Email").fill(adminAccount);
  await page.getByLabel("Clave").fill("DayqaAdmin2026!");
  await page.getByLabel("Rol").selectOption("editor");
  await page.getByRole("button", { name: "Guardar cuenta" }).click();
  await expect(page.locator("body")).toContainText(adminAccount, { timeout: 20000 });

  await page.goto(`${baseURL}/admin/backups`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Backup DB" }).click();
  await expect(page.locator("body")).toContainText("global-norte-database", { timeout: 30000 });

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify({
    suffix,
    guestOrder,
    registeredOrder,
    productCode,
    bannerTitle,
    notificationTitle,
    couponCode,
    bonusName,
    adminAccount,
  }, null, 2));
});
