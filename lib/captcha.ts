export async function verifyCaptcha(token: string | undefined | null) {
  if (!token) return false;
  const secret = process.env.HCAPTCHA_SECRET_KEY;
  if (!secret) return token.trim().length > 0;

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const response = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as { success?: boolean };
  return Boolean(data.success);
}
