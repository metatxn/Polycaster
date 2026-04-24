import type { SVGProps } from "react";

/**
 * Minimalist whale silhouette — side-view with a tail fluke peeking
 * out to the right. Single-path flat shape so it renders cleanly at
 * 12-24px and inherits `currentColor`. Used as the section glyph for
 * the Whale Ledger and inline before whale-type chip rows.
 */
export function WhaleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="280"
      height="180"
      viewBox="0 0 28 18"
      fill="#111111"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden
      {...props}
    >
      <title>Whale</title>
      <path d="M2 8.5c0-3 2.6-5.5 6.2-5.5h7.2c3 0 5.6 1.6 6.7 4l4.4-2.2c.3-.1.5.1.5.4v10.6c0 .3-.2.4-.5.3l-4.4-2.2c-1.1 2.4-3.7 4-6.7 4H8.2C4.6 17.9 2 15.4 2 12.4V8.5zm5.7-.2a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6z" />
    </svg>
  );
}
