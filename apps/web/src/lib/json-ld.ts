/**
 * Safe serialization for embedding JSON-LD inside
 * <script type="application/ld+json"> blocks.
 *
 * JSON.stringify alone is NOT safe for inline <script> content: a string
 * value containing "</script>" terminates the script element early and the
 * remainder is parsed as HTML — i.e. markup/script injection. Escaping "<"
 * as \u003c (plus the JS line separators U+2028/U+2029) yields a byte-
 * different but JSON-identical payload: JSON.parse returns the same value,
 * and breakout becomes impossible.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
