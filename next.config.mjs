/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(isDev ? ["'unsafe-eval'"] : []),
  "https://hcaptcha.com",
  "https://*.hcaptcha.com",
].join(" ");
const connectSrc = [
  "'self'",
  ...(isDev ? ["ws:", "wss:"] : []),
  "https://hcaptcha.com",
  "https://*.hcaptcha.com",
].join(" ");

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; img-src 'self' data: blob: https://picsum.photos https://fastly.picsum.photos https://images.unsplash.com; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; frame-src https://hcaptcha.com https://*.hcaptcha.com; connect-src ${connectSrc};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
