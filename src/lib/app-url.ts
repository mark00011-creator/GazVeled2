/** Production app origin – used when redirect must not fall back to localhost. */
export const PRODUCTION_APP_URL = "https://gazveeled2.vercel.app";

/**
 * Client-safe app origin for auth redirects (password recovery, email confirm).
 * Prefers the current browser origin on production; uses VITE_APP_URL for local dev
 * when the app is served from localhost.
 */
export function getAppOrigin(): string {
  const configured = import.meta.env.VITE_APP_URL as string | undefined;
  if (typeof window === "undefined") {
    return configured?.replace(/\/$/, "") || PRODUCTION_APP_URL;
  }
  const origin = window.location.origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return configured?.replace(/\/$/, "") || origin;
  }
  return origin;
}

export function getPasswordResetRedirectUrl(): string {
  return `${getAppOrigin()}/update-password`;
}

/** Minimum password length aligned with Supabase auth settings. */
export const MIN_PASSWORD_LENGTH = 8;

export function validatePasswordPair(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A jelszónak legalább ${MIN_PASSWORD_LENGTH} karakter hosszúnak kell lennie.`;
  }
  if (password !== confirm) {
    return "A két jelszó nem egyezik.";
  }
  return null;
}
