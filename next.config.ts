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
};

export default nextConfig;
