import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export default defineConfig({
  base: "/",
  root: path.join(project, "tencent/web"),
  publicDir: path.join(project, "public"),
  plugins: [react()],
  resolve: { alias: { "@": project } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: path.join(project, ".sites-runtime/tencent-static"), emptyOutDir: true, reportCompressedSize: false },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
