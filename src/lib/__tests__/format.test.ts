import { describe, expect, it } from "vitest";
import { groupTyped, numberInputText, parseNum } from "../format";

describe("number boxes", () => {
  it("group the whole part with commas while typing", () => {
    expect(groupTyped("1")).toBe("1");
    expect(groupTyped("1000")).toBe("1,000");
    expect(groupTyped("10000000")).toBe("10,000,000");
    expect(groupTyped("1,0000")).toBe("10,000");
    expect(groupTyped("10 000 000")).toBe("10,000,000");
  });
  it("keep the decimal point and what follows it", () => {
    expect(groupTyped("1234.")).toBe("1,234.");
    expect(groupTyped("1234.5")).toBe("1,234.5");
    expect(groupTyped("0.035")).toBe("0.035");
    expect(groupTyped(".5")).toBe(".5");
  });
  it("read dots in threes as grouping and drop a stray dot", () => {
    expect(groupTyped("10.000.000")).toBe("10,000,000");
    expect(groupTyped("10.000.")).toBe("10,000");
    expect(groupTyped("1,234.5.")).toBe("1,234.5");
    expect(groupTyped("1.5.5")).toBe("1.55");
  });
  it("keep a leading minus and accounting brackets as negative", () => {
    expect(groupTyped("-")).toBe("-");
    expect(groupTyped("-1234")).toBe("-1,234");
    expect(groupTyped("(1,234)")).toBe("-1,234");
  });
  it("drop leading zeros and anything that is not a number", () => {
    expect(groupTyped("007")).toBe("7");
    expect(groupTyped("0")).toBe("0");
    expect(groupTyped("12a3")).toBe("123");
    expect(groupTyped("")).toBe("");
  });
  it("show stored numbers with all their decimals", () => {
    expect(numberInputText(1234567)).toBe("1,234,567");
    expect(numberInputText(-1234567.89)).toBe("-1,234,567.89");
    expect(numberInputText(0.035)).toBe("0.035");
    expect(numberInputText(null)).toBe("");
  });
  it("read back what they show", () => {
    for (const text of ["10,000,000", "1,234.5", "-1,234", "0.035", "1,234.", ".5"]) {
      expect(parseNum(text)).toBe(parseNum(groupTyped(text)));
    }
    expect(parseNum("1,234.")).toBe(1234);
    expect(parseNum(".")).toBeNull();
    expect(parseNum(numberInputText(-1234567.89))).toBe(-1234567.89);
  });
});
