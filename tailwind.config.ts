import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          red: "#D32F2F",
          darkred: "#B71C1C",
          lightred: "#EF5350",
          black: "#1A1A1A",
          gray: "#424242",
          surface: "#F8F8F8",
        },
      },
      boxShadow: {
        soft: "0 4px 12px rgba(0,0,0,0.10)",
        lift: "0 8px 24px rgba(0,0,0,0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
