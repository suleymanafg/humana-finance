// Compares engine results with the figures the workbook calculates.
import type { Computed } from "../src/lib/engine/types";
import type { Expected } from "./workbook";

const TOLERANCE = 1; // UZS

export function engineFigures(c: Computed): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const put = (key: string, month: string, v: number) => {
    (out[key] ??= {})[month] = v;
  };
  c.ti.forEach((t) => {
    const m = t.monthId;
    put("ti.revenue", m, t.revenue);
    put("ti.cogs", m, t.cogs);
    put("ti.giveaways", m, t.giveaways);
    put("ti.grossProfit", m, t.grossProfit);
    put("ti.opex", m, t.opex);
    put("ti.ebitda", m, t.ebitda);
    put("ti.profitTax", m, t.profitTax);
    put("ti.vatCost", m, t.vatCost);
    put("ti.netProfit", m, t.netProfit);
    put("ti.importVat", m, t.vat.importVat);
    put("ti.outputInvoices", m, t.vat.outputInvoices);
    put("ti.outputOther", m, t.vat.outputOther);
    put("ti.netModel", m, t.vat.netModel);
    put("ti.perAccount", m, t.vat.perAccount);
    put("ti.accountBalance", m, t.vat.accountBalance);
    put("ti.priorOwnerPart", m, t.vat.priorOwnerPart);
  });
  c.fargo.forEach((f) => {
    const m = f.monthId;
    put("fargo.bankRevenue", m, f.bankRevenue);
    put("fargo.cashRevenue", m, f.cashRevenue);
    put("fargo.revenue", m, f.revenue);
    put("fargo.salesAtPrice", m, f.salesAtPrice);
    put("fargo.cashDeclared", m, f.cashDeclared);
    put("fargo.units", m, f.units);
    put("fargo.cogs", m, f.cogs);
    // the workbook has one stock-difference line: write-offs plus what the count finds
    put("fargo.stockLoss", m, f.stockLoss + f.writeOffLoss);
    put("fargo.writeOffsRecorded", m, f.writeOffsRecorded);
    put("fargo.grossProfit", m, f.grossProfit);
    put("fargo.opex", m, f.opex);
    put("fargo.incomeTax", m, f.incomeTax);
    put("fargo.netProfit", m, f.netProfit);
    put("fargo.vatInput", m, f.vat.input);
    put("fargo.vatOutputBank", m, f.vat.outputBank);
    put("fargo.vatOutputCash", m, f.vat.outputCash);
    put("fargo.vatNet", m, f.vat.net);
    put("fargo.vatPaid", m, f.vat.paid);
    put("fargo.vatCredit", m, f.vat.creditOut);
  });
  c.group.forEach((g) => {
    const m = g.monthId;
    put("group.revenue", m, g.revenue);
    put("group.cogs", m, g.cogs);
    put("group.giveaways", m, g.giveaways);
    put("group.stockLoss", m, g.stockLoss + g.fargoWriteOffs);
    put("group.grossProfit", m, g.grossProfit);
    put("group.opex", m, g.opex);
    put("group.ebitda", m, g.ebitda);
    put("group.taxes", m, g.taxes);
    put("group.netProfit", m, g.netProfit);
    put("group.check", m, g.recon.check);
  });
  c.settlement.forEach((s) => {
    const m = s.monthId;
    put("settlement.actBalance", m, s.actBalance);
    put("settlement.notGoods", m, s.notGoods);
    put("settlement.partnership", m, s.partnership);
    put("settlement.owesByAct", m, s.owesByAct);
    put("settlement.byBank", m, s.byBank);
    put("settlement.inCash", m, s.inCash);
    put("settlement.owes", m, s.owes);
    put("settlement.check", m, s.check);
    put("settlement.unsoldStockVat", m, s.unsoldStockVat);
    put("settlement.owesWhenSold", m, s.owesWhenSold);
    put("settlement.byBankWhenSold", m, s.byBankWhenSold);
    put("settlement.inCashWhenSold", m, s.inCashWhenSold);
  });
  c.balance.forEach((b) => {
    const m = b.monthId;
    put("bsTi.receivableFromFargo", m, b.ti.receivableFromFargo);
    put("bsTi.stock", m, b.ti.stock);
    put("bsTi.vatOverpaid", m, b.ti.vatOverpaid);
    put("bsTi.assets", m, b.ti.assets);
    put("bsTi.liabilities", m, b.ti.liabilities);
    put("bsTi.equity", m, b.ti.equity);
    put("bsTi.unreconciled", m, b.ti.unreconciled);
    put("bsTi.unreconciledCash", m, b.ti.unreconciledCash);
    put("bsTi.unreconciledVat", m, b.ti.unreconciledVat);
    put("bsFargo.stock", m, b.fargo.stock);
    put("bsFargo.vatCredit", m, b.fargo.vatCredit);
    put("bsFargo.cashHeld", m, b.fargo.cashHeld);
    put("bsFargo.assets", m, b.fargo.assets);
    put("bsFargo.equity", m, b.fargo.equity);
    put("bsFargo.check", m, b.fargo.check);
    put("bsGroup.stock", m, b.group.stock);
    put("bsGroup.assets", m, b.group.assets);
    put("bsGroup.liabilities", m, b.group.liabilities);
    put("bsGroup.equity", m, b.group.equity);
    put("bsGroup.unreconciled", m, b.group.unreconciled);
  });
  return out;
}

export function compareWithWorkbook(c: Computed, expected: Expected, reportTo: string) {
  const ours = engineFigures(c);
  const lines: string[] = [];
  let checked = 0;
  let failed = 0;
  for (const [key, byMonth] of Object.entries(expected.rows)) {
    const misses: string[] = [];
    for (const [month, want] of Object.entries(byMonth)) {
      if (month > reportTo) continue;
      const got = ours[key]?.[month];
      checked += 1;
      if (got === undefined || Math.abs(got - want) > TOLERANCE) {
        failed += 1;
        misses.push(`${month}: ${got === undefined ? "missing" : Math.round(got)} vs ${Math.round(want)}`);
      }
    }
    if (misses.length > 0) lines.push(`  ✗ ${key} — ${misses.slice(0, 4).join("; ")}${misses.length > 4 ? ` (+${misses.length - 4})` : ""}`);
  }
  lines.unshift(
    failed === 0
      ? `Engine reproduces the workbook: ${checked} figures checked, all within ${TOLERANCE} UZS.`
      : `Engine differs from the workbook on ${failed} of ${checked} figures:`
  );
  return { ok: failed === 0, checked, failed, lines };
}
