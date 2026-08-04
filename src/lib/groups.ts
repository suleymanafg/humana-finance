// Fixed P&L OPEX groups per company. OpexCategory.plGroup must be one of
// these keys (or null => UNMAPPED, surfaced in Health Check).

export const TI_GROUPS = [
  "TI_SALARIES",
  "TI_TAXES_SOCIAL",
  "TI_BANK_FEES",
  "TI_OFFICE_RENT",
  "TI_MEDICAL_INVEST",
  "TI_MARKETING",
  "TI_OTHERS",
  "TI_CERT_TOX",
] as const;

export const FARGO_GROUPS = [
  "FG_SALES_KPI",
  "FG_WAREHOUSE",
  "FG_LOGISTICS",
  "FG_OFFICE_ADMIN",
  "FG_FINANCE_MGMT",
  "FG_MARKETING",
] as const;

export type TiGroup = (typeof TI_GROUPS)[number];
export type FargoGroup = (typeof FARGO_GROUPS)[number];

export const GROUP_LABELS: Record<string, { ru: string; en: string }> = {
  TI_SALARIES: { ru: "Зарплаты", en: "Salaries" },
  TI_TAXES_SOCIAL: { ru: "Налоги и соцвзносы", en: "Taxes & Social" },
  TI_BANK_FEES: { ru: "Банковские услуги", en: "Bank Fees" },
  TI_OFFICE_RENT: { ru: "Офис и аренда", en: "Office & Rent" },
  TI_MEDICAL_INVEST: { ru: "Медицинская инвестиция", en: "Medical Investment" },
  TI_MARKETING: { ru: "Маркетинг и реклама", en: "Marketing & Advertising" },
  TI_OTHERS: { ru: "Прочие", en: "Others" },
  TI_CERT_TOX: { ru: "Сертификат и токсикология", en: "Certificate & Toxicology" },
  FG_SALES_KPI: { ru: "Торговая команда и KPI", en: "Sales Team & KPI" },
  FG_WAREHOUSE: { ru: "Склад", en: "Warehouse" },
  FG_LOGISTICS: { ru: "Логистика и ГСМ", en: "Logistics & Fuel" },
  FG_OFFICE_ADMIN: { ru: "Офис и администрация", en: "Office & Admin" },
  FG_FINANCE_MGMT: { ru: "Финансы и управление", en: "Finance & Management" },
  FG_MARKETING: { ru: "Маркетинг и реклама", en: "Marketing & Advertising" },
  UNMAPPED: { ru: "⚠ БЕЗ ГРУППЫ", en: "⚠ UNMAPPED" },
};
