import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

export type SessionKind = "customer" | "admin";

export interface SessionPayload {
  id: string;
  email: string;
  role: string;
  kind: SessionKind;
}

export const CUSTOMER_COOKIE = "gn_customer";
export const ADMIN_COOKIE = "gn_admin";

function secret() {
  const value = process.env.JWT_SECRET ?? "";
  if (value.length < 32) {
    throw new Error("JWT_SECRET debe tener al menos 32 caracteres.");
  }
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
}

export async function verifySession(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.id !== "string" || typeof payload.email !== "string") return null;
    if (payload.kind !== "customer" && payload.kind !== "admin") return null;
    return {
      id: payload.id,
      email: payload.email,
      role: typeof payload.role === "string" ? payload.role : "cliente",
      kind: payload.kind,
    };
  } catch {
    return null;
  }
}

export async function sessionFromRequest(request: NextRequest, kind: SessionKind) {
  const cookieName = kind === "admin" ? ADMIN_COOKIE : CUSTOMER_COOKIE;
  return verifySession(request.cookies.get(cookieName)?.value);
}

export async function setSessionCookie(response: NextResponse, payload: SessionPayload) {
  const cookieName = payload.kind === "admin" ? ADMIN_COOKIE : CUSTOMER_COOKIE;
  response.cookies.set(cookieName, await signSession(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export function clearSessionCookie(response: NextResponse, kind: SessionKind) {
  response.cookies.set(kind === "admin" ? ADMIN_COOKIE : CUSTOMER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
