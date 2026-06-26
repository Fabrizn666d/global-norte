import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Global Norte Perú",
  description: "Distribuidora mayorista de productos para bodegas, minimarkets, restaurantes y negocios en el Perú.",
  applicationName: "Global Norte Perú",
  generator: "Global Norte Perú",
  authors: [{ name: "Global Norte Perú" }],
  keywords: ["Distribuidora", "Mayorista", "Bodegas", "Abarrotes", "Perú", "Global Norte"],
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Global Norte Perú",
    description: "Distribuidora mayorista de productos para bodegas, minimarkets, restaurantes y negocios en el Perú.",
    siteName: "Global Norte Perú",
    type: "website",
    locale: "es_PE",
  },
  twitter: {
    title: "Global Norte Perú",
    description: "Distribuidora mayorista de productos para bodegas, minimarkets, restaurantes y negocios en el Perú.",
    card: "summary",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={jakarta.variable}>
      <body>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
