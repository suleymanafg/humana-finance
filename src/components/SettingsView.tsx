"use client";

// Reference module: products, channels, months, category mappings, tax constants.
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardHeader, Input, PageTitle, Select } from "./ui";
import EntryGrid, { type Col } from "./EntryGrid";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { GROUP_LABELS, TI_GROUPS, FARGO_GROUPS } from "@/lib/groups";
import { fmtN, parseNum } from "@/lib/format";
import type { TaxSettings } from "@/lib/engine/types";
import type { DictKey } from "@/lib/i18n";

export default function SettingsView({
  products,
  channels,
  months,
  warehouses,
  opexCategories,
  importCategories,
  clients,
  taxes,
  readOnly,
}: {
  products: Array<{ id: string; nameRu: string; nameEn: string; code1c: string; productLine: string; price: number; isPromo: boolean; regularProductId: string; sortOrder: number }>;
  channels: Array<{ id: string; name: string; code1c: string; retroPct: number; cashPct: number; bankPct: number; sortOrder: number }>;
  months: Array<{ id: string; nameRu: string; nameEn: string; sortOrder: number }>;
  warehouses: Array<{ id: string; name: string; code1c: string; sortOrder: number }>;
  opexCategories: Array<{ id: string; company: string; name: string; plGroup: string; sortOrder: number }>;
  importCategories: Array<{ id: string; name: string }>;
  clients: ClientRowUI[];
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

        <ClientsCard clients={clients} channels={channels} readOnly={readOnly} />

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

// ── «Клиенты» — 1C client registry with channel assignment ───────
interface ClientRowUI {
  id: string;
  displayName: string;
  channelId: string; // "" = unassigned (auto-fallback, never reviewed)
  source: string; // "auto" | "manual"
  lastSeenAt: string; // ISO date
  totalQty: number;
}

function ClientsCard({
  clients,
  channels,
  readOnly,
}: {
  clients: ClientRowUI[];
  channels: Array<{ id: string; name: string; sortOrder: number }>;
  readOnly: boolean;
}) {
  const { t, locale } = useT();
  const ru = locale === "ru";
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const visible = (c: ClientRowUI) => !needle || c.displayName.toLowerCase().includes(needle);
  const unassigned = clients.filter((c) => !c.channelId && visible(c));
  const groups = channels
    .map((ch) => ({ ch, rows: clients.filter((c) => c.channelId === ch.id && visible(c)) }))
    .filter((g) => g.rows.length > 0);
  const unassignedTotal = clients.filter((c) => !c.channelId).length;

  async function assign(id: string, channelId: string) {
    if (!channelId) return;
    setBusyId(id);
    // an explicit admin choice — «Прочие» included — marks the client reviewed
    await crud("clientChannelMap", "update", {
      id,
      data: { channelId, source: "manual", matchedRule: "manual" },
    });
    setBusyId(null);
    router.refresh();
  }

  const picker = (c: ClientRowUI, placeholder: string) =>
    readOnly ? (
      <span className="text-[12.5px] text-muted">—</span>
    ) : (
      <Select
        value={c.channelId}
        disabled={busyId === c.id}
        onChange={(e) => assign(c.id, e.target.value)}
      >
        <option value="">{placeholder}</option>
        {channels.map((ch) => (
          <option key={ch.id} value={ch.id}>
            {ch.name}
          </option>
        ))}
      </Select>
    );

  const row = (c: ClientRowUI, placeholder: string) => (
    <tr key={c.id}>
      <td className="max-w-[320px] truncate" title={c.displayName}>
        {c.displayName}
      </td>
      <td>{picker(c, placeholder)}</td>
      <td>
        <Badge tone={c.source === "manual" ? "accent" : "neutral"}>
          {c.source === "manual" ? t("sourceManual") : t("sourceAuto")}
        </Badge>
      </td>
      <td className="num text-right">{fmtN(c.totalQty)}</td>
      <td className="text-right text-[12px] text-muted">{c.lastSeenAt}</td>
    </tr>
  );

  const head = (
    <tr>
      <th>{ru ? "Клиент (1С)" : "Client (1C)"}</th>
      <th>{t("channel")}</th>
      <th>{ru ? "Источник" : "Source"}</th>
      <th className="text-right">{t("qty")}</th>
      <th className="text-right">{t("clientLastSeen")}</th>
    </tr>
  );

  return (
    <Card>
      <CardHeader
        title={`${t("settingsClients")} (${clients.length})`}
        desc={t("settingsClientsDesc")}
        right={
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("clientSearch")}
            className="w-56"
          />
        }
      />

      {unassignedTotal > 0 && (
        <div className="border-b border-warn/25 bg-warn-soft/40">
          <div className="flex items-baseline gap-2 px-4 pb-1 pt-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-warn">
              {t("clientsUnassigned")} · {unassignedTotal}
            </span>
            <span className="text-[12px] text-muted">{t("clientsUnassignedHint")}</span>
          </div>
          {unassigned.length > 0 && (
            <div className="overflow-x-auto pb-2">
              <table className="tbl">
                <thead>{head}</thead>
                <tbody>{unassigned.map((c) => row(c, ru ? "Назначить канал…" : "Assign channel…"))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>{head}</thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.ch.id}>
                <tr className="bg-surface-low/60">
                  <td colSpan={5} className="text-[12px] font-semibold text-muted">
                    {g.ch.name} · {g.rows.length}
                  </td>
                </tr>
                {g.rows.map((c) => row(c, "—"))}
              </Fragment>
            ))}
            {groups.length === 0 && unassigned.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-[13px] text-muted">
                  {needle
                    ? ru
                      ? "Ничего не найдено"
                      : "No matches"
                    : ru
                      ? "Реестр пуст — заполнится при первой синхронизации 1С"
                      : "Empty — populates on the first 1C sync"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
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
