
import { describe, expect, it } from "vitest";
import { localInput, microToUsd, usdToMicro } from "@/components/demo-center/format";

describe("Unidades de Demo Center", () => {
  it("convierte USD y micro-USD con exactitud entera", () => {
    for (const amount of ["0", "1", "1.000001", "999999999999.999999"]) {
      const micro = usdToMicro(amount);
      expect(usdToMicro(microToUsd(micro))).toBe(micro);
    }
    expect(() => usdToMicro("0.0000001")).toThrow();
    expect(() => usdToMicro("-1")).toThrow();
  });
  it("representa el instante en hora local con segundos", () => {
    const value = new Date("2026-11-04T21:00:30.000Z");
    expect(new Date(localInput(value)).getTime()).toBe(value.getTime());
    expect(localInput(null)).toBe("");
  });
});
