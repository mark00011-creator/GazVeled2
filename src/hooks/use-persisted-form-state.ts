/**
 * Űrlapállapot sessionStorage-ban – ablakváltás / navigáció után is megmarad.
 * Új moduloknál: ezt (vagy useWorkflowDraft-ot üzleti folyamathoz) használd, ne nyers useState-et.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useLocation } from "@tanstack/react-router";
import {
  buildRouteStateKey,
  clearRouteState,
  loadRouteState,
  mergeRouteUi,
  saveRouteState,
} from "@/lib/route-state-storage";

type Options = {
  /** Egyedi kulcs az oldalon belül (pl. "create", "invite"). */
  formKey: string;
  enabled?: boolean;
};

export function usePersistedFormState<T extends Record<string, unknown>>(
  defaults: T,
  options: Options,
): {
  state: T;
  setState: Dispatch<SetStateAction<T>>;
  patch: (partial: Partial<T>) => void;
  reset: () => void;
  storageKey: string;
} {
  const location = useLocation();
  const { formKey, enabled = true } = options;
  const storageKey = buildRouteStateKey(location.pathname, null, [`form:${formKey}`]);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [state, setState] = useState<T>(() => {
    if (!enabled) return { ...defaults };
    const snap = loadRouteState<T>(storageKey);
    return mergeRouteUi(defaults, snap?.ui);
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKeyRef = useRef(storageKey);

  useEffect(() => {
    if (prevKeyRef.current === storageKey) return;
    prevKeyRef.current = storageKey;
    if (!enabled) {
      setState({ ...defaultsRef.current });
      return;
    }
    const snap = loadRouteState<T>(storageKey);
    setState(mergeRouteUi(defaultsRef.current, snap?.ui));
  }, [storageKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveRouteState(storageKey, { ui: stateRef.current, scrollY: window.scrollY });
    }, 150);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, enabled, storageKey]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      saveRouteState(storageKey, { ui: stateRef.current, scrollY: window.scrollY });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [enabled, storageKey]);

  const patch = useCallback((partial: Partial<T>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => {
    clearRouteState(storageKey);
    setState({ ...defaultsRef.current });
  }, [storageKey]);

  return { state, setState, patch, reset, storageKey };
}
