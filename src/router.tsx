import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Window scroll + UI state: useRouteStatePersistence (sessionStorage), async listákhoz.
    scrollRestoration: false,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
