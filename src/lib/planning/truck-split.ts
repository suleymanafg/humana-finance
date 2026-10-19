// Splits a month's load into trucks the way HQ's order form counts them:
// every truck as close to the same fill as whole pallets allow (HQ's form must
// show 0.98 for each). The load's places are shared out in the pallets' steps
// (0.8 and 1.2 places → 0.4): every truck gets the same number of steps, the
// last ones one more where it does not divide. Each truck then gets a count of
// the bigger pallets (AC/AR, 1.2) that lets the small ones (0.8) fill it
// exactly — at 32.4 places that is an odd number of them — as near an even
// share as it allows. Products go out in turn, biggest first, so a product
// stays in as few trucks as possible. Pure — no DB.

export interface SplitSku {
  id: string;
  pcsPerPallet: number;
  placesPerPallet: number;
}

export interface TruckLoad {
  /** pallets per SKU */
  pallets: Record<string, number>;
  units: Record<string, number>;
  places: number;
}

const EPS = 1e-6;

/** The step whole pallets move a truck's places in: the common divisor of the pallet sizes (0.8 and 1.2 → 0.4). */
export function placeStep(sizes: number[]): number {
  const ints = sizes.filter((x) => x > 0).map((x) => Math.round(x * 1000));
  if (ints.length === 0) return 1;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  return ints.reduce((g, x) => gcd(g, x)) / 1000;
}

export function splitIntoTrucks(units: Record<string, number>, skus: SplitSku[], trucks: number, truckPlaces = 33): TruckLoad[] {
  if (trucks <= 0) return [];
  const pal = Object.fromEntries(skus.map((s) => [s.id, Math.round((units[s.id] ?? 0) / (s.pcsPerPallet || 1))]));
  const w = Object.fromEntries(skus.map((s) => [s.id, s.placesPerPallet || 1]));
  const live = skus.filter((s) => pal[s.id] > 0);
  const result = (out: Record<string, number>[]) =>
    out.map((p) => ({
      pallets: p,
      units: Object.fromEntries(Object.entries(p).map(([id, n]) => [id, n * (skus.find((s) => s.id === id)?.pcsPerPallet ?? 0)])),
      places: Object.entries(p).reduce((s, [id, n]) => s + n * w[id], 0),
    }));
  if (live.length === 0) return result(Array.from({ length: trucks }, () => ({})));

  const step = placeStep(live.map((s) => w[s.id]));
  const steps = (x: number) => Math.round(x / step);
  const smallest = Math.min(...live.map((s) => w[s.id]));
  const byCount = (a: SplitSku, b: SplitSku) => pal[b.id] - pal[a.id];
  const small = live.filter((s) => w[s.id] <= smallest + EPS).sort(byCount);
  const big = live.filter((s) => w[s.id] > smallest + EPS).sort(byCount);
  const bigSizes = [...new Set(big.map((s) => steps(w[s.id])))];

  // per truck: how many big and small pallets
  const counts = bigSizes.length <= 1 ? exactCounts() : null;
  function exactCounts(): { a: number; b: number }[] | null {
    const sS = steps(smallest);
    const bS = bigSizes[0] ?? 0;
    let A = small.reduce((t, s) => t + pal[s.id], 0);
    let B = big.reduce((t, s) => t + pal[s.id], 0);
    const K = A * sS + B * bS;
    const base = Math.floor(K / trucks);
    const more = K - base * trucks;
    const out: { a: number; b: number }[] = [];
    for (let i = 0; i < trucks; i++) {
      const left = trucks - i;
      if (left === 1) {
        out.push({ a: A, b: B });
        break;
      }
      const k = base + (i >= trucks - more ? 1 : 0);
      const want = B / left;
      let best: { a: number; b: number } | null = null;
      for (let b = 0; b <= B && b * bS <= k; b++) {
        const r = k - b * bS;
        if (r % sS !== 0 || r / sS > A) continue;
        if (!best || Math.abs(b - want) < Math.abs(best.b - want)) best = { a: r / sS, b };
      }
      if (!best) return null;
      out.push(best);
      A -= best.a;
      B -= best.b;
    }
    return out;
  }

  const out: Record<string, number>[] = Array.from({ length: trucks }, () => ({}));
  const put = (t: number, id: string, n: number) => { if (n > 0) out[t][id] = (out[t][id] ?? 0) + n; };
  if (counts) {
    // deal the products out in turn: truck 1 takes its count from the first products, then truck 2 …
    const deal = (list: SplitSku[], need: (t: number) => number) => {
      const left = Object.fromEntries(list.map((s) => [s.id, pal[s.id]]));
      let j = 0;
      for (let t = 0; t < trucks; t++) {
        let n = need(t);
        while (n > 0 && j < list.length) {
          const id = list[j].id;
          const k = Math.min(n, left[id]);
          put(t, id, k);
          left[id] -= k;
          n -= k;
          if (left[id] === 0) j++;
        }
      }
    };
    deal(big, (t) => counts[t].b);
    deal(small, (t) => counts[t].a);
    return result(out);
  }

  // mixed big sizes: the bigger pallets one to each truck, then in pairs to the truck with the most room,
  // the rest filling truck 1 up to the average, then truck 2 …
  const placesOf = (t: Record<string, number>) => Object.entries(t).reduce((s, [id, n]) => s + n * w[id], 0);
  const target = Math.min(truckPlaces, Math.ceil(placesOf(pal) / trucks / step - EPS) * step);
  const bigLeft = Object.fromEntries(big.map((s) => [s.id, pal[s.id]]));
  const take = () => { const s = big.find((x) => bigLeft[x.id] > 0); if (s) bigLeft[s.id] -= 1; return s?.id; };
  for (let t = 0; t < trucks; t++) { const id = take(); if (id) put(t, id, 1); }
  for (;;) {
    const a = take();
    if (!a) break;
    const b = take();
    const t = out.map((x, i) => [i, placesOf(x)] as const).sort((x, y) => x[1] - y[1])[0][0];
    put(t, a, 1);
    if (b) put(t, b, 1);
  }
  let t = 0;
  for (const s of small) {
    let left = pal[s.id];
    while (left > 0) {
      const room = Math.floor((Math.min(truckPlaces, t === trucks - 1 ? truckPlaces : target) - placesOf(out[t]) + EPS) / w[s.id]);
      if (room <= 0 && t < trucks - 1) { t++; continue; }
      const n = t === trucks - 1 ? left : Math.min(left, room);
      put(t, s.id, n);
      left -= n;
      if (left > 0 && t < trucks - 1) t++;
    }
  }
  return result(out);
}
