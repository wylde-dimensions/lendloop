import type { SVGProps } from "react";

/** Lucide has no ladder; this one matches its 24px, 2px-stroke style. */
export function Ladder(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 2 5 22" />
      <path d="M17 2l2 20" />
      <path d="M6.6 6h10.8" />
      <path d="M6.2 11h11.6" />
      <path d="M5.8 16h12.4" />
    </svg>
  );
}
