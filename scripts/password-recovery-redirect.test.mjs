import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("auth uses production-safe password reset redirect", () => {
  const auth = fs.readFileSync(path.join(root, "src/routes/auth.tsx"), "utf8");
  assert.match(auth, /getPasswordResetRedirectUrl/);
  assert.doesNotMatch(auth, /redirectTo:\s*`\$\{window\.location\.origin\}\/auth`/);
  assert.doesNotMatch(auth, /localhost/);
});

test("update-password route handles recovery flow securely", () => {
  const page = fs.readFileSync(path.join(root, "src/routes/update-password.tsx"), "utf8");
  assert.match(page, /PASSWORD_RECOVERY/);
  assert.match(page, /updateUser\(\{ password/);
  assert.match(page, /signOut/);
  assert.match(page, /validatePasswordPair/);
  assert.doesNotMatch(page, /access_token/);
  assert.doesNotMatch(page, /refresh_token/);
  assert.doesNotMatch(page, /console\.log/);
});

test("app-url defines production origin and reset path", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/app-url.ts"), "utf8");
  assert.match(src, /gazveeled2\.vercel\.app/);
  assert.match(src, /\/update-password/);
  assert.match(src, /MIN_PASSWORD_LENGTH/);
});
