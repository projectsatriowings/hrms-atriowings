import { useId } from "react";

/**
 * Attenza brand mark — the geometric "A" (Sharika's pick, Canva variant 3,
 * 2026-10-20): a gradient triangle-A with a triangular counter, drawn with an
 * even-odd fill so the counter knocks out cleanly at any size.
 */
export function LogoMark({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `attenza-g-${uid}`;
  return (
    <svg viewBox="0 0 100 92" className={className} role="img" aria-label="Attenza" fill="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="100" y2="92" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4F46E5" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill={`url(#${gradientId})`}
        d="M50 2 L98 90 L2 90 Z M50 40 L66.5 72 L33.5 72 Z"
      />
    </svg>
  );
}
