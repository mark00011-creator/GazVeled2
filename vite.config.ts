// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import fs from "node:fs";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";

/** Nitro/Vercel only ships `public/` as static files; copy generated SW there after build. */
function copyPwaAssetsToPublic() {
  return {
    name: "copy-pwa-assets-to-public",
    apply: "build" as const,
    closeBundle() {
      const distDir = path.resolve("dist");
      const publicDir = path.resolve("public");
      if (!fs.existsSync(distDir)) return;
      const files = fs.readdirSync(distDir).filter((f) => f === "sw.js" || f.startsWith("workbox-"));
      for (const file of files) {
        fs.copyFileSync(path.join(distDir, file), path.join(publicDir, file));
      }
    },
  };
}

export default defineConfig({
  nitro: { preset: "vercel" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: false,
        manifest: false,
        includeAssets: ["manifest.json", "icons/icon-192.png", "icons/icon-512.png"],
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,json,webmanifest}"],
          navigateFallback: "/",
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: {
          enabled: true,
          type: "module",
        },
      }),
      copyPwaAssetsToPublic(),
    ],
  },
});
