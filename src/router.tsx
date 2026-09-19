import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Ablakváltáskor ne indítson felesleges refetch-et (űrlapok / lista flicker).
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Window scroll + UI state: useRouteStatePersistence (sessionStorage), async listákhoz.
    scrollRestoration: false,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
