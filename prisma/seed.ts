// Master-data seed — idempotent (upserts by deterministic ids / unique keys).
// Run: npx prisma db seed   (or: npx tsx prisma/seed.ts)
import { newPrismaClient } from "../src/lib/prisma-factory";
import { hashPassword } from "../src/lib/auth-crypto";

const prisma = newPrismaClient();

const REGULAR_PRICE = 135_800;
const PROMO_PRICE = 101_850;

// ⚠ Assumption to verify: which 3 SKUs have promo "(АКЦИЯ)" variants.
// Seeded as the three Platin 400г SKUs — editable in Settings → Products.
const products: Array<{
  id: string;
  nameRu: string;
  nameEn: string;
  price: number;
  isPromo?: boolean;
  regularProductId?: string;
}> = [
  { id: "p-platin1-400", nameRu: "Humana Platin 1 MP 400г", nameEn: "Humana Platin 1 MP 400g", price: REGULAR_PRICE },
  { id: "p-platin1-800", nameRu: "Humana Platin 1 MP 800г", nameEn: "Humana Platin 1 MP 800g", price: REGULAR_PRICE },
  { id: "p-platin2-400", nameRu: "Humana Platin 2 MP 400г", nameEn: "Humana Platin 2 MP 400g", price: REGULAR_PRICE },
  { id: "p-platin2-800", nameRu: "Humana Platin 2 MP 800г", nameEn: "Humana Platin 2 MP 800g", price: REGULAR_PRICE },
  { id: "p-platin3-400", nameRu: "Humana Platin 3 MP 400г", nameEn: "Humana Platin 3 MP 400g", price: REGULAR_PRICE },
  { id: "p-platin3-800", nameRu: "Humana Platin 3 MP 800г", nameEn: "Humana Platin 3 MP 800g", price: REGULAR_PRICE },
  { id: "p-hn-300", nameRu: "Humana HN Expert FS 300г", nameEn: "Humana HN Expert FS 300g", price: REGULAR_PRICE },
  { id: "p-sl-500", nameRu: "Humana SL Expert BIB 500г", nameEn: "Humana SL Expert BIB 500g", price: REGULAR_PRICE },
  { id: "p-ac-350", nameRu: "Humana AC Expert DS 350г×12", nameEn: "Humana AC Expert DS 350g×12", price: REGULAR_PRICE },
  { id: "p-ar-350", nameRu: "Humana AR Expert DS 350г×12", nameEn: "Humana AR Expert DS 350g×12", price: REGULAR_PRICE },
  { id: "p-platin1-400-promo", nameRu: "Humana Platin 1 MP 400г (АКЦИЯ)", nameEn: "Humana Platin 1 MP 400g (PROMO)", price: PROMO_PRICE, isPromo: true, regularProductId: "p-platin1-400" },
  { id: "p-platin2-400-promo", nameRu: "Humana Platin 2 MP 400г (АКЦИЯ)", nameEn: "Humana Platin 2 MP 400g (PROMO)", price: PROMO_PRICE, isPromo: true, regularProductId: "p-platin2-400" },
  { id: "p-platin3-400-promo", nameRu: "Humana Platin 3 MP 400г (АКЦИЯ)", nameEn: "Humana Platin 3 MP 400g (PROMO)", price: PROMO_PRICE, isPromo: true, regularProductId: "p-platin3-400" },
];

const CITY = { retroPct: 0.08, cashPct: 0.336 };
// ⚠ Percentages below follow the spec examples; verify the rest in Settings → Channels.
const channels: Array<{ id: string; name: string; retroPct: number; cashPct: number }> = [
  { id: "ch-gorod", name: "Город", ...CITY },
  { id: "ch-karshi", name: "Карши", ...CITY },
  { id: "ch-samarkand", name: "Самарканд", ...CITY },
  { id: "ch-bukhara", name: "Бухара", ...CITY },
  { id: "ch-termez", name: "Термез", ...CITY },
  { id: "ch-navoi", name: "Навои", ...CITY },
  { id: "ch-urgench", name: "Ургенч", ...CITY },
  { id: "ch-jizzakh", name: "Джизак", ...CITY },
  { id: "ch-andijan", name: "Андижан", ...CITY },
  { id: "ch-kokand", name: "Коканд", ...CITY },
  { id: "ch-namangan", name: "Наманган", ...CITY },
  { id: "ch-fergana", name: "Фергана", ...CITY },
  { id: "ch-bonduelle", name: "Дилеры Бондюэль", retroPct: 0.04, cashPct: 0 },
  { id: "ch-korzinka", name: "Корзинка", retroPct: 0.11, cashPct: 0 },
  { id: "ch-bi1", name: "NEW RETAIL (Bi1)", retroPct: 0.05, cashPct: 0 },
  { id: "ch-darvoza", name: "DARVOZA SAVDO", retroPct: 0.06, cashPct: 0 },
  { id: "ch-tiin", name: "ТИИН ОПТОМ", retroPct: 0, cashPct: 0 },
  { id: "ch-uzum", name: "UZUM MARKET", retroPct: 0, cashPct: 0 },
  { id: "ch-bigmag", name: "BIGMAG RETAIL", retroPct: 0, cashPct: 0 },
  { id: "ch-jeti", name: "JETI ASPAN", retroPct: 0, cashPct: 0 },
  { id: "ch-ofis", name: "Офис", retroPct: 0, cashPct: 1 },
  { id: "ch-magazin-fargo", name: "Магазин Fargo", retroPct: 0, cashPct: 1 },
  { id: "ch-abdurakhman", name: "ХУМАНА АБДУРАХМАН", retroPct: 0, cashPct: 1 },
  { id: "ch-prochie", name: "Прочие", retroPct: 0, cashPct: 1 },
];

const MONTHS_RU = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function buildMonths() {
  const list: Array<{ id: string; nameRu: string; nameEn: string; sortOrder: number }> = [];
  let order = 0;
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2025 && m < 8) continue;
      const id = `${y}-${String(m).padStart(2, "0")}`;
      list.push({ id, nameRu: `${MONTHS_RU[m - 1]} ${y}`, nameEn: `${MONTHS_EN[m - 1]} ${y}`, sortOrder: order++ });
    }
  }
  return list;
}

const tiOpexCategories: Array<[string, string]> = [
  ["Зарплата", "TI_SALARIES"],
  ["Премии", "TI_SALARIES"],
  ["Налоги и соцвзносы", "TI_TAXES_SOCIAL"],
  ["ИНПС и соцстрах", "TI_TAXES_SOCIAL"],
  ["Банковские услуги", "TI_BANK_FEES"],
  ["Конвертация валюты", "TI_BANK_FEES"],
  ["Аренда офиса", "TI_OFFICE_RENT"],
  ["Коммунальные услуги", "TI_OFFICE_RENT"],
  ["Канцтовары и хозрасходы", "TI_OFFICE_RENT"],
  ["Медицинская инвестиция", "TI_MEDICAL_INVEST"],
  ["Сертификат", "TI_CERT_TOX"],
  ["Токсикология", "TI_CERT_TOX"],
  ["Командировки", "TI_OTHERS"],
  ["Представительские", "TI_OTHERS"],
  ["Прочие расходы", "TI_OTHERS"],
];

const fargoOpexCategories: Array<[string, string]> = [
  ["Зарплата торговой команды", "FG_SALES_KPI"],
  ["KPI бонусы", "FG_SALES_KPI"],
  ["Аренда склада", "FG_WAREHOUSE"],
  ["Персонал склада", "FG_WAREHOUSE"],
  ["Логистика", "FG_LOGISTICS"],
  ["ГСМ", "FG_LOGISTICS"],
  ["Аренда офиса", "FG_OFFICE_ADMIN"],
  ["Административные расходы", "FG_OFFICE_ADMIN"],
  ["Финансовый отдел", "FG_FINANCE_MGMT"],
  ["Управление", "FG_FINANCE_MGMT"],
];

const marketingCategories = [
  "Реклама",
  "SMM и блогеры",
  "Промо-акции",
  "Дегустации",
  "Полиграфия",
  "Мерчандайзинг",
  "Прочее",
];

const importExpenseCategories = [
  "Сертификат",
  "Маркировка",
  "НДС (импорт)",
  "Хранение",
  "Транспорт",
  "Стикер",
  "Декларант",
  "Списания",
];

async function main() {
  // products: regulars first (promo FK depends on them)
  for (const p of products.filter((x) => !x.isPromo)) {
    await prisma.product.upsert({
      where: { id: p.id },
      create: { ...p, isPromo: false, sortOrder: products.indexOf(p) },
      update: { nameRu: p.nameRu, nameEn: p.nameEn, price: p.price, sortOrder: products.indexOf(p) },
    });
  }
  for (const p of products.filter((x) => x.isPromo)) {
    await prisma.product.upsert({
      where: { id: p.id },
      create: { ...p, isPromo: true, sortOrder: products.indexOf(p) },
      update: { nameRu: p.nameRu, nameEn: p.nameEn, price: p.price, regularProductId: p.regularProductId, sortOrder: products.indexOf(p) },
    });
  }

  for (const [i, c] of channels.entries()) {
    await prisma.channel.upsert({
      where: { id: c.id },
      create: { ...c, sortOrder: i },
      update: { name: c.name, sortOrder: i }, // keep user-edited percentages on reseed
    });
  }

  for (const m of buildMonths()) {
    await prisma.month.upsert({ where: { id: m.id }, create: m, update: m });
  }

  for (const [i, [name, plGroup]] of tiOpexCategories.entries()) {
    await prisma.opexCategory.upsert({
      where: { company_name: { company: "TI", name } },
      create: { company: "TI", name, plGroup, sortOrder: i },
      update: { sortOrder: i },
    });
  }
  for (const [i, [name, plGroup]] of fargoOpexCategories.entries()) {
    await prisma.opexCategory.upsert({
      where: { company_name: { company: "FARGO", name } },
      create: { company: "FARGO", name, plGroup, sortOrder: i },
      update: { sortOrder: i },
    });
  }

  for (const name of marketingCategories) {
    await prisma.marketingCategory.upsert({ where: { name }, create: { name }, update: {} });
  }

  // default warehouse — add the real 1C warehouse list in Settings → Склады
  await prisma.warehouse.upsert({
    where: { name: "Основной склад" },
    create: { id: "wh-main", name: "Основной склад", sortOrder: 0 },
    update: {},
  });
  for (const name of importExpenseCategories) {
    await prisma.importExpenseCategory.upsert({ where: { name }, create: { name }, update: {} });
  }

  const settings: Record<string, unknown> = {
    taxes: {
      vatRate: 0.12, // Fargo VAT
      deemedCashMargin: 0.03, // deemed margin on cash sales
      fargoIncomeTaxRate: 0.019, // % of revenue
      tiIncomeTaxRate: 0.15, // % of taxable profit
    },
    golden: {
      // known-good YTD values from the Excel workbook (Aug'25–Apr'26)
      toMonthId: "2026-04",
      revenue: 26_269_537_700,
      cogs: 14_867_863_161,
      netProfit: 737_104_688,
      gpMarginPct: 0.434,
    },
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value) },
      update: {}, // don't overwrite user-edited settings
    });
  }

  // default users — change passwords after first login (Settings → Users)
  for (const u of [
    { username: "admin", password: "admin123", role: "ADMIN" },
    { username: "viewer", password: "viewer123", role: "VIEWER" },
  ]) {
    const existing = await prisma.user.findUnique({ where: { username: u.username } });
    if (!existing) {
      await prisma.user.create({
        data: { username: u.username, passwordHash: hashPassword(u.password), role: u.role },
      });
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
