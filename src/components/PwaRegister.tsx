import { useEffect } from "react";
import { registerSW } from "virtual:pwa-register";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    registerSW({
      immediate: true,
      onRegistered(registration) {
        if (registration) {
          console.info("[PWA] Service worker registered:", registration.scope);
        }
      },
      onRegisterError(error) {
        console.error("[PWA] Service worker registration failed:", error);
      },
    });
  }, []);

  return null;
}
