import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  clearWorkflowDraft,
  createWorkflowDraftId,
  isWorkflowDraftAlreadyCompleted,
  loadWorkflowDraft,
  markWorkflowDraftCompleted,
  saveWorkflowDraft,
  workflowDraftStorageKey,
} from "@/lib/workflow-draft-storage";

type UseWorkflowDraftOptions<T extends { version: number; draftId: string }> = {
  storageKey: string;
  userId?: string;
  version: number;
  validate: (value: unknown) => value is T;
  isEmpty: (draft: T) => boolean;
  restoreMessage?: string;
};

export function useWorkflowDraft<T extends { version: number; draftId: string }>(
  buildDraft: () => T,
  applyDraft: (draft: T) => void,
  saveDeps: unknown[],
  options: UseWorkflowDraftOptions<T>,
) {
  const { storageKey, userId, version, validate, isEmpty, restoreMessage } = options;
  const resolvedKey = userId ? workflowDraftStorageKey(storageKey, userId) : null;
  const draftIdRef = useRef<string>(createWorkflowDraftId());
  const hydratedKeyRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitInFlightRef = useRef(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!resolvedKey || hydratedKeyRef.current === resolvedKey) return;
    hydratedKeyRef.current = resolvedKey;
    const existing = loadWorkflowDraft(resolvedKey, version, validate);
    if (!existing || isEmpty(existing)) {
      if (existing) clearWorkflowDraft(resolvedKey);
      return;
    }
    if (isWorkflowDraftAlreadyCompleted(existing.draftId)) {
      clearWorkflowDraft(resolvedKey);
      return;
    }
    draftIdRef.current = existing.draftId;
    applyDraft(existing);
    setRestored(true);
    toast.info(restoreMessage ?? "A korábban megkezdett csere visszaállítva.");
  }, [applyDraft, isEmpty, resolvedKey, restoreMessage, validate, version]);

  const persistDraft = useCallback(() => {
    if (!resolvedKey || hydratedKeyRef.current !== resolvedKey) return;
    const draft = buildDraft();
    draft.draftId = draftIdRef.current;
    if (isEmpty(draft)) {
      clearWorkflowDraft(resolvedKey);
      return;
    }
    saveWorkflowDraft(resolvedKey, draft);
  }, [buildDraft, isEmpty, resolvedKey]);

  useEffect(() => {
    if (!resolvedKey || hydratedKeyRef.current !== resolvedKey) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistDraft();
    }, 250);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveDeps lists workflow fields
  }, [resolvedKey, persistDraft, ...saveDeps]);

  const clearDraft = useCallback(() => {
    draftIdRef.current = createWorkflowDraftId();
    if (resolvedKey) clearWorkflowDraft(resolvedKey);
    setRestored(false);
  }, [resolvedKey]);

  const markCompleted = useCallback(() => {
    markWorkflowDraftCompleted(draftIdRef.current);
    clearDraft();
  }, [clearDraft]);

  const beginSubmit = useCallback((): boolean => {
    if (submitInFlightRef.current) return false;
    if (isWorkflowDraftAlreadyCompleted(draftIdRef.current)) {
      toast.error("Ez a tranzakció már rögzítésre került. Indíts új folyamatot.");
      clearDraft();
      return false;
    }
    submitInFlightRef.current = true;
    return true;
  }, [clearDraft]);

  const endSubmit = useCallback(() => {
    submitInFlightRef.current = false;
  }, []);

  return {
    restored,
    clearDraft,
    markCompleted,
    beginSubmit,
    endSubmit,
  };
}
