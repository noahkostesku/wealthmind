"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  setCurrentPageStore,
  patchCurrentPageContext,
  expandWellyGlobal,
  prefillWellyGlobal,
} from "./pageContextStore";

interface PageContextValue {
  currentPage: string;
  pageContext: Record<string, unknown>;
  setPageContext: (ctx: Record<string, unknown>) => void;
  expandWelly: () => void;
  prefillWelly: (text: string) => void;
}

const PageContext = createContext<PageContextValue>({
  currentPage: "",
  pageContext: {},
  setPageContext: () => {},
  expandWelly: () => {},
  prefillWelly: () => {},
});

export function PageContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pageContext, setPageContextState] = useState<
    Record<string, unknown>
  >({});

  // Reset context on navigation
  useEffect(() => {
    setCurrentPageStore(pathname, {});
    setPageContextState({});
  }, [pathname]);

  const setPageContext = useCallback((ctx: Record<string, unknown>) => {
    patchCurrentPageContext(ctx);
    setPageContextState((prev) => ({ ...prev, ...ctx }));
  }, []);

  return (
    <PageContext.Provider
      value={{
        currentPage: pathname,
        pageContext,
        setPageContext,
        expandWelly: expandWellyGlobal,
        prefillWelly: prefillWellyGlobal,
      }}
    >
      {children}
    </PageContext.Provider>
  );
}

export function usePageContext() {
  return useContext(PageContext);
}
