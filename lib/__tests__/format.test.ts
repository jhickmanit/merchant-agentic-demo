import { describe, it, expect } from "vitest";
import { formatCents } from "@/lib/format";

describe("formatCents", () => {
  it("formats 0", () => expect(formatCents(0)).toBe("$0.00"));
  it("formats 6500", () => expect(formatCents(6500)).toBe("$65.00"));
  it("formats 38999", () => expect(formatCents(38999)).toBe("$389.99"));
  it("formats 1", () => expect(formatCents(1)).toBe("$0.01"));
});
