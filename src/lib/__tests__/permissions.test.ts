import { describe, expect, it } from "vitest";
import { canAccessPath, homeOf } from "../permissions";
import { visibleSections } from "../nav";

describe("who may open what", () => {
  it("the medical team opens only its page and the password change — nothing with money, no API, no chat", () => {
    for (const p of ["/medical", "/change-password"]) expect(canAccessPath("MEDICAL", p)).toBe(true);
    for (const p of ["/", "/sales", "/sales/products", "/statements/pnl", "/budget", "/planning", "/goods/stock", "/settings", "/api/chat", "/api/crud/sale", "/api/export/statement", "/api/budget", "/api/planning/inputs"]) {
      expect(canAccessPath("MEDICAL", p)).toBe(false);
    }
    expect(homeOf("MEDICAL")).toBe("/medical");
    expect(visibleSections("MEDICAL").map((s) => s.key)).toEqual(["medical"]);
  });

  it("the owner sees the medical page too; staff and viewers do not", () => {
    expect(canAccessPath("ADMIN", "/medical")).toBe(true);
    expect(canAccessPath("STAFF", "/medical")).toBe(false);
    expect(canAccessPath("VIEWER", "/medical")).toBe(false);
    expect(homeOf("ADMIN")).toBe("/");
    expect(visibleSections("STAFF").some((s) => s.key === "medical")).toBe(false);
  });

  it("other roles keep their rules", () => {
    expect(canAccessPath("STAFF", "/sales")).toBe(true);
    expect(canAccessPath("STAFF", "/budget")).toBe(false);
    expect(canAccessPath("ADMIN", "/budget")).toBe(true);
  });
});
