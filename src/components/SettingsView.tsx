"use client";

// Reference module: products, channels, months, category mappings, tax constants.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Input, PageTitle } from "./ui";
import EntryGrid, { type Col } from "./EntryGrid";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { GROUP_LABELS, TI_GROUPS, FARGO_GROUPS } from "@/lib/groups";
import { parseNum } from "@/lib/format";
import type { TaxSettings } from "@/lib/engine/types";
import type { DictKey } from "@/lib/i18n";

export default function SettingsView({
  products,
  channels,
  months,
  warehouses,
  opexCategories,
  importCategories,
  taxes,
  readOnly,
}: {
  products: Array<{ id: string; nameRu: string; nameEn: string; code1c: string; productLine: string; price: number; isPromo: boolean; regularProductId: string; sortOrder: number }>;
  channels: Array<{ id: string; name: string; code1c: string; retroPct: number; cashPct: number; bankPct: number; sortOrder: number }>;
  months: Array<{ id: string; nameRu: string; nameEn: string; sortOrder: number }>;
  warehouses: Array<{ id: string; name: string; code1c: string; sortOrder: number }>;
  opexCategories: Array<{ id: string; company: string; name: string; plGroup: string; sortOrder: number }>;
  importCategories: Array<{ id: string; name: string }>;
  taxes: TaxSettings;
  readOnly: boolean;
}) {
  const { t, locale } = useT();

  const regularOptions = [
    { value: "", label: "—" },
    ...products.filter((p) => !p.isPromo).map((p) => ({ value: p.id, label: p.nameRu })),
  ];

  const productCols: Col[] = [
    { field: "nameRu", label: "Название (RU)", type: "text", width: "220px" },
    { field: "nameEn", label: "Name (EN)", type: "text", width: "200px" },
    { field: "code1c", labelKey: "code1c", type: "text", width: "110px" },
    {
      field: "productLine",
      labelKey: "productLine",
      type: "select",
      options: [
        { value: "Platin", label: "Platin" },
        { value: "Expert", label: "Expert" },
        { value: "", label: "—" },
      ],
    },
    { field: "price", labelKey: "price", type: "number" },
    { field: "isPromo", labelKey: "isPromo", type: "bool" },
    { field: "regularProductId", labelKey: "regularProduct", type: "select", options: regularOptions },
    { field: "sortOrder", label: "#", type: "number" },
  ];

  const channelCols: Col[] = [
    { field: "name", labelKey: "name", type: "text", width: "200px" },
    { field: "code1c", labelKey: "code1c", type: "text", width: "120px" },
    { field: "retroPct", labelKey: "retroPct", type: "number", decimals: 3 },
    { field: "cashPct", labelKey: "cashPct", type: "number", decimals: 3 },
    { field: "bankPct", labelKey: "bankPct", type: "number", decimals: 3, readOnly: true },
    { field: "sortOrder", label: "#", type: "number" },
  ];

  const groupOptions = (company: string) => [
    { value: "", label: GROUP_LABELS.UNMAPPED[locale] },
    ...(company === "TI" ? TI_GROUPS : FARGO_GROUPS).map((g) => ({
      value: g,
      label: GROUP_LABELS[g][locale],
    })),
  ];

  const monthCols: Col[] = [
    { field: "id", label: "ID", type: "text", width: "100px" },
    { field: "nameRu", label: "Название (RU)", type: "text" },
    { field: "nameEn", label: "Name (EN)", type: "text" },
    { field: "sortOrder", label: "#", type: "number" },
  ];

  const nameCols: Col[] = [{ field: "name", labelKey: "name", type: "text" }];

  return (
    <div>
      <PageTitle title={t("navSettings")} subtitle={t("descSettings")} />
      <div className="space-y-4">
        <Card>
          <CardHeader title={`${t("settingsProducts")} (${products.length})`} />
          <EntryGrid entity="product" cols={productCols} rows={products} readOnly={readOnly} />
        </Card>

        <Card>
          <CardHeader
            title={`${t("settingsChannels")} (${channels.length})`}
            right={<span className="text-[12px] text-muted">0.08 = 8%</span>}
          />
          <EntryGrid entity="channel" cols={channelCols} rows={channels} readOnly={readOnly} />
        </Card>

        <TaxesCard taxes={taxes} readOnly={readOnly} />

        <div className="grid gap-4 lg:grid-cols-2">
          {(["TI", "FARGO"] as const).map((company) => (
            <Card key={company}>
              <CardHeader
                title={`${t("settingsOpexCategories")} — ${company === "TI" ? "Turbo Impex" : "Fargo"}`}
              />
              <EntryGrid
                entity="opexCategory"
                cols={[
                  { field: "name", labelKey: "name", type: "text", width: "200px" },
                  { field: "plGroup", labelKey: "group", type: "select", options: groupOptions(company) },
                  { field: "sortOrder", label: "#", type: "number" },
                ]}
                rows={opexCategories.filter((c) => c.company === company)}
                readOnly={readOnly}
                defaults={{ company }}
              />
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("settingsImportCategories")} />
            <EntryGrid entity="importExpenseCategory" cols={nameCols} rows={importCategories} readOnly={readOnly} />
          </Card>
        </div>

        <Card>
          <CardHeader title={t("settingsWarehouses")} desc={t("stockApiHint")} />
          <EntryGrid
            entity="warehouse"
            cols={[
              { field: "name", labelKey: "name", type: "text", width: "240px" },
              { field: "code1c", labelKey: "code1c", type: "text", width: "180px" },
              { field: "sortOrder", label: "#", type: "number" },
            ]}
            rows={warehouses}
            readOnly={readOnly}
          />
        </Card>

        <Card>
          <CardHeader title={t("settingsMonths")} />
          <EntryGrid entity="month" cols={monthCols} rows={months} readOnly={readOnly} />
        </Card>
      </div>
    </div>
  );
}

const TAX_FIELDS: Array<{ field: keyof TaxSettings; key: DictKey }> = [
  { field: "vatRate", key: "vatRate" },
  { field: "deemedCashMargin", key: "deemedCashMargin" },
  { field: "fargoIncomeTaxRate", key: "fargoIncomeTaxRate" },
  { field: "tiIncomeTaxRate", key: "tiIncomeTaxRate" },
];

function TaxesCard({ taxes, readOnly }: { taxes: TaxSettings; readOnly: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(TAX_FIELDS.map(({ field }) => [field, String(taxes[field])]))
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const value: Record<string, number> = {};
    for (const { field } of TAX_FIELDS) value[field] = parseNum(draft[field]) ?? 0;
    await crud("setting", "upsert", { data: { key: "taxes", value: JSON.stringify(value) } });
    setBusy(false);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title={t("settingsTaxes")} right={<span className="text-[12px] text-muted">0.12 = 12%</span>} />
      <div className="flex flex-wrap items-end gap-4 p-4">
        {TAX_FIELDS.map(({ field, key }) => (
          <div key={field}>
            <label className="mb-1 block text-[12px] text-muted">{t(key)}</label>
            <Input
              value={draft[field]}
              disabled={readOnly}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              className="w-36 text-right"
            />
          </div>
        ))}
        {!readOnly && (
          <Button onClick={save} disabled={busy}>
            {t("save")}
          </Button>
        )}
      </div>
    </Card>
  );
}
