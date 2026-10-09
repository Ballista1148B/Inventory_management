import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";

/** GET `path` whenever path/params change. Pass a falsy path to skip fetching. */
export function useFetch(path, params = {}) {
  const key = (path || "") + JSON.stringify(params);
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false }); return; }
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path, params).then(
      (data) => !stale && setState({ data, error: null, loading: false }),
      (error) => !stale && setState({ data: null, error, loading: false })
    );
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Filter state lives in the URL, so filtered views are linkable and survive refresh. */
export function useQueryFilters() {
  const [sp, setSp] = useSearchParams();
  const filters = Object.fromEntries(sp);
  const setFilters = (patch) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v == null || v === false) next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in patch)) next.delete("page"); // changing a filter returns to page 1
    setSp(next, { replace: true });
  };
  return [filters, setFilters];
}

export const fmtDate = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "none";
export const fmtMoney = (n) => `$${Number(n).toFixed(2)}`;
export const fmtNum = (n) => Number(n).toLocaleString("en-US");
export const today = () => new Date().toISOString().slice(0, 10);
