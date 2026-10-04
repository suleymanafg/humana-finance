// First in, first out: the value of the first n units drawn from batches in
// order. Matches the workbook's piecewise formula exactly, including its edge
// rules: n ≤ 0 is valued at the first batch's unit value, and units beyond the
// last batch continue at the last batch's unit value.

export interface Batch {
  qty: number;
  unit: number; // value per unit
}

export class FifoCurve {
  private readonly cumBefore: number[] = [];
  private readonly valueBefore: number[] = [];
  private readonly units: number[] = [];

  constructor(batches: Batch[]) {
    let qty = 0;
    let value = 0;
    for (const b of batches) {
      this.cumBefore.push(qty);
      this.valueBefore.push(value);
      this.units.push(b.unit);
      qty += b.qty;
      value += b.qty * b.unit;
    }
  }

  get isEmpty(): boolean {
    return this.units.length === 0;
  }

  /** Value of the first n units. */
  valueAt(n: number): number {
    if (this.units.length === 0) return 0;
    if (n <= 0) return n * this.units[0];
    // last batch whose cumulative start is ≤ n
    let lo = 0;
    let hi = this.cumBefore.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumBefore[mid] <= n) lo = mid;
      else hi = mid - 1;
    }
    return this.valueBefore[lo] + (n - this.cumBefore[lo]) * this.units[lo];
  }

  /** Value of the units from position `from` (exclusive) to `to`. */
  between(from: number, to: number): number {
    return this.valueAt(to) - this.valueAt(from);
  }
}
