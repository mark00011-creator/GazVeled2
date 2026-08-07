/** Production auth diagnostic logger – no tokens, no secrets. */
export function authDiag(payload: Record<string, unknown>) {
  console.log("[AUTH-DIAG]", payload);
}
