import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Global Norte Perú",
    short_name: "Global Norte",
    description: "Distribuidora mayorista de productos para bodegas, minimarkets, restaurantes y negocios en el Perú.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#D71920",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
