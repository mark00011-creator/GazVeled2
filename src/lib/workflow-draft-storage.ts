/** Perzisztens kliensoldali workflow-piszkozat tárolás (localStorage). */

import { QUICK_EXCHANGE_DRAFT_KEY } from "@/lib/quick-exchange-draft";
import { SUPPLIER_EXCHANGE_DRAFT_KEY } from "@/lib/supplier-exchange-draft";

const COMPLETED_IDS_KEY = "gazveeled:workflow-draft:completed-ids";
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;

export function workflowDraftStorageKey(baseKey: string, userId: string): string {
  return `${baseKey}:${userId}`;
}

export function clearUserWorkflowDrafts(userId: string) {
  clearWorkflowDraft(workflowDraftStorageKey(QUICK_EXCHANGE_DRAFT_KEY, userId));
  clearWorkflowDraft(workflowDraftStorageKey(SUPPLIER_EXCHANGE_DRAFT_KEY, userId));
}

type CompletedEntry = { id: string; at: number };

function readCompletedIds(): CompletedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(COMPLETED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter(
        (e): e is CompletedEntry =>
          !!e &&
          typeof e === "object" &&
          typeof (e as CompletedEntry).id === "string" &&
          typeof (e as CompletedEntry).at === "number" &&
          now - (e as CompletedEntry).at < COMPLETED_TTL_MS,
      )
      .slice(-50);
  } catch {
    return [];
  }
}

function writeCompletedIds(entries: CompletedEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COMPLETED_IDS_KEY, JSON.stringify(entries));
  } catch {
    // Quota vagy privát mód – nem blokkoló.
  }
}

export function markWorkflowDraftCompleted(draftId: string) {
  const entries = readCompletedIds().filter((e) => e.id !== draftId);
  entries.push({ id: draftId, at: Date.now() });
  writeCompletedIds(entries);
}

export function isWorkflowDraftAlreadyCompleted(draftId: string): boolean {
  return readCompletedIds().some((e) => e.id === draftId);
}

export function loadWorkflowDraft<T extends { version: number }>(
  storageKey: string,
  expectedVersion: number,
  validate: (value: unknown) => value is T,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validate(parsed)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    if (parsed.version !== expectedVersion) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    return null;
  }
}

export function saveWorkflowDraft(storageKey: string, draft: object) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Quota – nem blokkoló.
  }
}

export function clearWorkflowDraft(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

export function createWorkflowDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
