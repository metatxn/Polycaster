"use client";

import { useEffect, useState } from "react";

/**
 * Ticking clock for "updated Xs ago" labels. Mount this in the LEAF
 * component that renders the label — never at page level, where every
 * tick re-renders the whole tree (the bug this hook replaces).
 */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
