/** Persist manufacturer/circulation through finalize via delivery_note_items.note. */

const PREFIX = "DNMETA:";

export type CylinderDisplayMeta = {
  manufacturer: string | null;
  circulation: string | null;
};

export function encodeCylinderMeta(
  meta: CylinderDisplayMeta,
  userNote?: string | null,
): string | null {
  const payload = JSON.stringify({
    m: meta.manufacturer ?? null,
    c: meta.circulation ?? null,
    n: userNote ?? null,
  });
  return `${PREFIX}${payload}`;
}

export function parseCylinderMeta(note: string | null | undefined): CylinderDisplayMeta & {
  userNote: string | null;
} {
  if (!note) return { manufacturer: null, circulation: null, userNote: null };
  if (!note.startsWith(PREFIX)) {
    return { manufacturer: null, circulation: null, userNote: note };
  }
  try {
    const j = JSON.parse(note.slice(PREFIX.length)) as {
      m?: string | null;
      c?: string | null;
      n?: string | null;
    };
    return {
      manufacturer: j.m ?? null,
      circulation: j.c ?? null,
      userNote: j.n ?? null,
    };
  } catch {
    return { manufacturer: null, circulation: null, userNote: note };
  }
}
