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
  },
};

export default nextConfig;
