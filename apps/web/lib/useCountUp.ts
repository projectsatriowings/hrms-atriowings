"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 to `target` over ~`duration`ms with an ease-out
 * curve. Respects prefers-reduced-motion by jumping straight to the value.
 * Returns the current (rounded) display value.
 */
export function useCountUp(target: number, duration = 700): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setDisplay(target);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target === 0) {
      setDisplay(target);
      return;
    }
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      setDisplay(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}
