import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev server runs with cwd = project dir; pin Turbopack's root here so the
  // parent workspace's lockfile doesn't get picked as the project root
  turbopack: {
    root: process.cwd(),
  },
  // OCR stack spawns worker threads and loads WASM at runtime — keep it out
  // of the bundle (invoice upload endpoint)
  serverExternalPackages: ["tesseract.js", "pdf-parse"],
  // pages moved into their sections; old links keep working
  async redirects() {
    return [
      { source: "/pnl", destination: "/statements/pnl", permanent: false },
      { source: "/balance", destination: "/statements/balance", permanent: false },
      { source: "/statements", destination: "/statements/pnl", permanent: false },
      { source: "/shipments", destination: "/goods/shipments", permanent: false },
      { source: "/goods", destination: "/goods/shipments", permanent: false },
      { source: "/opex-ti", destination: "/expenses/ti", permanent: false },
      { source: "/opex-fargo", destination: "/expenses/fargo", permanent: false },
      { source: "/expenses", destination: "/expenses/ti", permanent: false },
      { source: "/taxes", destination: "/taxes/fargo-vat", permanent: false },
      { source: "/funding", destination: "/funding/capital", permanent: false },
      { source: "/close/balance", destination: "/close", permanent: false },
      { source: "/api/export/pnl", destination: "/api/export/statement?kind=pnl", permanent: false },
      { source: "/api/export/balance", destination: "/api/export/statement?kind=balance", permanent: false },
    ];
  },
  // …and ship those packages' dynamically-loaded files with the function:
  // pdf.js requires @napi-rs/canvas inside a try/catch and loads its worker
  // by a computed path — Vercel's tracer misses both, which crashed the
  // route with "DOMMatrix is not defined" in production.
  outputFileTracingIncludes: {
    "/api/import/invoice": [
      "./node_modules/pdf-parse/dist/**",
      "./node_modules/pdfjs-dist/**",
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/tesseract.js/**",
      "./node_modules/tesseract.js-core/**",
    ],
    "/api/import/ti-invoice": [
      "./node_modules/pdf-parse/dist/**",
      "./node_modules/pdfjs-dist/**",
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
    ],
  },
};

export default nextConfig;
