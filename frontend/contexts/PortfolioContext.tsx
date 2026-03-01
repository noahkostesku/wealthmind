"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getPortfolio } from "@/lib/api";
import type { PortfolioSnapshot } from "@/types";

interface PortfolioContextType {
  portfolio: PortfolioSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextType>({
  portfolio: null,
  loading: true,
  error: null,
  refresh: async () => {},
});

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPortfolio();
      setPortfolio(data);
      setError(null);
    } catch {
      setError("Could not load portfolio data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PortfolioContext.Provider value={{ portfolio, loading, error, refresh }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  return useContext(PortfolioContext);
}
