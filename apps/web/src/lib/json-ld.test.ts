import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./json-ld";

describe("serializeJsonLd", () => {
  it("round-trips plain values unchanged", () => {
    const value = { name: "Will BTC close above $100k?", nested: { n: 1 } };
    expect(JSON.parse(serializeJsonLd(value))).toEqual(value);
  });

  it("escapes </script> so the payload cannot break out of the script tag", () => {
    const value = { name: "pwn</script><script>alert(1)</script>" };
    const serialized = serializeJsonLd(value);
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("escapes U+2028/U+2029 line separators", () => {
    const value = { name: "a\u2028b\u2029c" };
    const serialized = serializeJsonLd(value);
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(JSON.parse(serialized)).toEqual(value);
  });
});
