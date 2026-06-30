const PHONE_FORMAT_WARNING = "Ellenőrizd a telefonszám formátumát.";

function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

/** National digits without country code (8–9 digits for typical HU numbers). */
function extractNationalDigits(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let digits = digitsOnly(trimmed);
  if (!digits) return null;

  if (digits.startsWith("0036")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("36") && digits.length >= 10) {
    digits = digits.slice(2);
  } else if (digits.startsWith("06") && digits.length >= 10) {
    digits = digits.slice(2);
  } else if (digits.startsWith("6") && digits.length === 10) {
    digits = digits.slice(1);
  }

  if (digits.length === 9 || digits.length === 8) {
    return digits;
  }

  return null;
}

function formatNationalDigits(national: string): string {
  if (national.length === 9) {
    return `+36 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  }
  if (national.length === 8 && national.startsWith("1")) {
    return `+36 ${national.slice(0, 1)} ${national.slice(1, 4)} ${national.slice(4)}`;
  }
  if (national.length === 8) {
    return `+36 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  }
  return `+36 ${national}`;
}

export function isLikelyValidHungarianPhone(input: string | null | undefined): boolean {
  if (!input?.trim()) return false;
  return extractNationalDigits(input) !== null;
}

/** Normalize to +36 XX XXX XXXX when confidently Hungarian; otherwise return trimmed input unchanged. */
export function normalizeHungarianPhone(input: string | null | undefined): string | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return null;
  const national = extractNationalDigits(trimmed);
  if (!national) return trimmed;
  return formatNationalDigits(national);
}

export function formatPhoneDisplay(input: string | null | undefined): string {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return "—";
  const national = extractNationalDigits(trimmed);
  if (!national) return trimmed;
  return formatNationalDigits(national);
}

export function phoneToTelLink(input: string | null | undefined): string | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return null;
  const national = extractNationalDigits(trimmed);
  if (!national) return null;
  return `tel:+36${national}`;
}

export type PhoneSaveResult = {
  value: string | null;
  warning: string | null;
};

/** Use on partner create/update: normalize HU numbers, warn on unrecognized formats, never throw. */
export function preparePhoneForSave(input: string | null | undefined): PhoneSaveResult {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return { value: null, warning: null };

  if (isLikelyValidHungarianPhone(trimmed)) {
    return { value: normalizeHungarianPhone(trimmed), warning: null };
  }

  return { value: trimmed, warning: PHONE_FORMAT_WARNING };
}

export { PHONE_FORMAT_WARNING };
