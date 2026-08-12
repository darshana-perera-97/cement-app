import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { buildBrands, setCachedBrands } from './brandTheme';

const BagProductsContext = createContext({
  brands: [],
  products: [],
  loading: true,
  refresh: async () => {},
});

export function BagProductsProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const apiBase = getApiBase();
    try {
      const res = await fetch(`${apiBase}/api/bag-products`);
      if (res.ok) {
        const data = await res.json();
        setProducts(Array.isArray(data.products) ? data.products : []);
      } else {
        setProducts([]);
      }
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const brands = useMemo(() => buildBrands(products), [products]);

  useEffect(() => {
    setCachedBrands(brands);
  }, [brands]);

  const value = useMemo(
    () => ({ brands, products, loading, refresh }),
    [brands, products, loading, refresh],
  );

  return <BagProductsContext.Provider value={value}>{children}</BagProductsContext.Provider>;
}

export function useBagProducts() {
  return useContext(BagProductsContext);
}
