import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useLocation } from "@tanstack/react-router";
import {
  buildRouteStateKey,
  clampScrollY,
  clearRouteState,
  loadRouteState,
  mergeRouteUi,
  saveRouteState,
} from "@/lib/route-state-storage";

type KeyOptions = {
  keyParts?: Array<string | number | null | undefined>;
  storageKey?: string;
  enabled?: boolean;
};

function useResolvedRouteStorageKey(options: KeyOptions = {}): string {
  const location = useLocation();
  const { keyParts = [], storageKey: explicitKey } = options;
  const keyPartsJoined = keyParts.map((p) => String(p ?? "")).join("\0");

  return useMemo(() => {
    if (explicitKey) return explicitKey;
    const search =
      typeof location.searchStr === "string" && location.searchStr.length > 0
        ? location.searchStr
        : location.search;
    return buildRouteStateKey(
      location.pathname,
      search,
      keyPartsJoined ? keyPartsJoined.split("\0") : [],
    );
  }, [explicitKey, location.pathname, location.search, location.searchStr, keyPartsJoined]);
}

/**
 * Szűrő / keresés / tab UI-állapot sessionStorage-ban (nem üzleti draft).
 */
export function useRouteStatePersistence<T extends Record<string, unknown>>(
  defaults: T,
  options: KeyOptions = {},
): {
  state: T;
  setState: Dispatch<SetStateAction<T>>;
  patch: (partial: Partial<T>) => void;
  clear: () => void;
  restored: boolean;
  storageKey: string;
} {
  const { enabled = true } = options;
  const storageKey = useResolvedRouteStorageKey(options);
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [state, setState] = useState<T>(() => {
    if (!enabled) return { ...defaults };
    const snap = loadRouteState<T>(storageKey);
    return mergeRouteUi(defaults, snap?.ui);
  });

  const [restored] = useState(() => {
    if (!enabled) return false;
    const snap = loadRouteState<T>(storageKey);
    if (!snap) return false;
    return (
      snap.scrollY > 0 ||
      Object.keys(snap.ui).some((k) => snap.ui[k] !== defaults[k as keyof T])
    );
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

  const flushSave = useCallback(
    (scrollY?: number) => {
      if (!enabled) return;
      saveRouteState(storageKey, {
        ui: stateRef.current,
        scrollY: typeof scrollY === "number" ? scrollY : window.scrollY,
      });
    },
    [enabled, storageKey],
  );

  useEffect(() => {
    if (!enabled) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flushSave(), 150);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, enabled, flushSave]);

  const patch = useCallback((partial: Partial<T>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const clear = useCallback(() => {
    clearRouteState(storageKey);
    setState({ ...defaultsRef.current });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [storageKey]);

  return { state, setState, patch, clear, restored, storageKey };
}

/**
 * Window scroll mentés / visszaállítás route-kulcsonként.
 * Csak `ready === true` után restore-ol (async lista után).
 */
export function useRouteScrollRestoration(
  storageKey: string,
  ready: boolean,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const scrollRestoredRef = useRef(false);
  const prevKeyRef = useRef(storageKey);

  useEffect(() => {
    if (prevKeyRef.current !== storageKey) {
      prevKeyRef.current = storageKey;
      scrollRestoredRef.current = false;
    }
  }, [storageKey]);

  useEffect(() => {
    if (!enabled) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const prev = loadRouteState(storageKey);
        saveRouteState(storageKey, {
          scrollY: window.scrollY,
          ui: prev?.ui ?? {},
        });
      });
    };

    const onHide = () => {
      const prev = loadRouteState(storageKey);
      saveRouteState(storageKey, {
        scrollY: window.scrollY,
        ui: prev?.ui ?? {},
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      onHide();
    };
  }, [enabled, storageKey]);

  useLayoutEffect(() => {
    if (!enabled || !ready) return;
    if (scrollRestoredRef.current) return;
    const snap = loadRouteState(storageKey);
    if (!snap || snap.scrollY <= 0) {
      scrollRestoredRef.current = true;
      return;
    }
    scrollRestoredRef.current = true;
    const apply = () => {
      window.scrollTo({ top: clampScrollY(snap.scrollY), left: 0, behavior: "auto" });
    };
    apply();
    requestAnimationFrame(apply);
  }, [enabled, ready, storageKey]);
}

/** Scroll-only oldalakhoz: üres UI + scroll restore. */
export function useRouteScrollOnly(ready: boolean, options: KeyOptions = {}) {
  const { storageKey } = useRouteStatePersistence({}, options);
  useRouteScrollRestoration(storageKey, ready, { enabled: options.enabled !== false });
  return storageKey;
}
