import { pageContext, type SearchParams } from "@/lib/page-context";
import { loadTransition, outletFunnel, outletViews } from "@/lib/transition/data";
import { OUTLET_STATUS, OUTLET_TYPES, normName, optionsOf } from "@/lib/transition/model";
import { fmtN, fmtPct } from "@/lib/format";
import { Figure, ParamSelect, Toolbar } from "@/components/statement";
import EntryGrid from "@/components/EntryGrid";
import ImportButton from "@/components/transition/ImportButton";
import { ParamSearch, PostButton } from "@/components/transition/TrActions";

const monthLabel = (m: string) => `${m.slice(5, 7)}.${m.slice(0, 4)}`;

export default async function TransitionOutlets({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const data = await loadTransition();
  const { rows: all, months } = await outletViews(data);
  const funnel = outletFunnel(all);

  const region = sp.region ?? "all";
  const status = sp.status ?? "all";
  const q = normName(sp.q ?? "");
  const rows = all
    .filter((o) => region === "all" || (region === "none" ? !o.regionId : o.regionId === region))
    .filter((o) => status === "all" || o.status === status)
    .filter((o) => !q || normName(`${o.name} ${o.district} ${o.contact}`).includes(q))
    .sort((a, b) => b.recentValue - a.recentValue || a.name.localeCompare(b.name, "ru"));

  const regionOptions = data.regions.map((r) => ({ value: r.id, label: r.name }));
  const statusCount = (s: string) => funnel.byStatus[s] ?? 0;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label={ctx.l({ ru: "Точек в реестре", en: "Outlets in the register" })} value={fmtN(funnel.total)} sub={ctx.l({ ru: `активных ${funnel.active}`, en: `${funnel.active} active` })} />
        <Figure
          label={ctx.l({ ru: "Договор с TI", en: "Signed with TI" })}
          value={fmtN(funnel.signed)}
          sub={ctx.l({ ru: `${fmtPct(funnel.signedShare)} недавних продаж`, en: `${fmtPct(funnel.signedShare)} of recent sales` })}
        />
        <Figure
          label={ctx.l({ ru: "В работе", en: "In progress" })}
          value={fmtN(statusCount("CONTACTED") + statusCount("CONTRACT_SENT"))}
          sub={ctx.l({ ru: `договор отправлен ${statusCount("CONTRACT_SENT")}`, en: `${statusCount("CONTRACT_SENT")} contracts sent` })}
        />
        <Figure
          label={ctx.l({ ru: "Ещё не связались", en: "Not contacted yet" })}
          value={fmtN(statusCount("TO_CONTACT"))}
          sub={ctx.l({ ru: `потеряно ${statusCount("LOST")}`, en: `${statusCount("LOST")} lost` })}
        />
      </div>

      <Toolbar>
        <ParamSelect
          param="region"
          value={region}
          options={[
            { value: "all", label: ctx.l({ ru: "Все регионы", en: "All regions" }) },
            { value: "none", label: ctx.l({ ru: "Без региона", en: "No region" }) },
            ...regionOptions,
          ]}
        />
        <ParamSelect
          param="status"
          value={status}
          options={[{ value: "all", label: ctx.l({ ru: "Все статусы", en: "All statuses" }) }, ...optionsOf(OUTLET_STATUS, ctx.locale)]}
        />
        <ParamSearch param="q" value={sp.q ?? ""} placeholder={{ ru: "Поиск: название, район, контакт", en: "Search: name, district, contact" }} />
        <span className="text-[12px] text-muted">
          {ctx.l({ ru: `Показано ${rows.length}`, en: `${rows.length} shown` })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PostButton
            url="/api/transition/outlets-from-sales"
            body={{ months: 6 }}
            label={{ ru: "Добавить клиентов из 1С (6 мес.)", en: "Add clients from 1C (6 months)" }}
            done={{ ru: "Добавлено точек: {added}", en: "Outlets added: {added}" }}
          />
          <ImportButton
            kind="outlets"
            title={{ ru: "Загрузить список Fargo", en: "Upload Fargo's list" }}
            hint={{
              ru: "Список точек с контактами из Excel. Точки находятся по названию: существующие дополняются, новые добавляются.",
              en: "An outlet list with contacts from Excel. Outlets are matched by name: existing ones are filled in, new ones are added.",
            }}
            fields={[
              { key: "name", label: { ru: "Название точки", en: "Outlet name" }, required: true, synonyms: ["контрагент", "клиент", "наимен", "назван", "точка", "client", "customer", "name", "outlet"] },
              { key: "region", label: { ru: "Регион / канал", en: "Region / channel" }, synonyms: ["регион", "область", "канал", "region", "channel", "viloyat"] },
              { key: "district", label: { ru: "Район", en: "District" }, synonyms: ["район", "district", "tuman"] },
              { key: "type", label: { ru: "Тип", en: "Type" }, synonyms: ["тип", "вид", "type"] },
              { key: "contact", label: { ru: "Контактное лицо", en: "Contact person" }, synonyms: ["контакт", "фио", "ответствен", "contact"] },
              { key: "phone", label: { ru: "Телефон", en: "Phone" }, synonyms: ["телефон", "тел", "phone", "mobile"] },
              { key: "creditDays", label: { ru: "Отсрочка, дней", en: "Credit, days" }, synonyms: ["отсроч", "кредит", "дней", "credit", "days"] },
              { key: "contractNo", label: { ru: "№ договора", en: "Contract no." }, synonyms: ["договор", "contract"] },
              { key: "notes", label: { ru: "Заметки", en: "Notes" }, synonyms: ["примеч", "коммент", "note", "comment"] },
            ]}
          />
        </div>
      </Toolbar>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <EntryGrid
          entity="trOutlet"
          rows={rows.map((o) => ({ ...o, creditDays: o.creditDays }))}
          defaults={{
            status: "TO_CONTACT",
            type: "SHOP",
            ...(region !== "all" && region !== "none" ? { regionId: region } : {}),
          }}
          cols={[
            { field: "name", label: ctx.l({ ru: "Точка", en: "Outlet" }), type: "text", width: "220px" },
            { field: "regionId", label: ctx.l({ ru: "Регион", en: "Region" }), type: "select", options: [{ value: "", label: "—" }, ...regionOptions], width: "150px" },
            { field: "district", label: ctx.l({ ru: "Район", en: "District" }), type: "text", width: "120px" },
            { field: "type", label: ctx.l({ ru: "Тип", en: "Type" }), type: "select", options: optionsOf(OUTLET_TYPES, ctx.locale), width: "110px" },
            { field: "status", label: ctx.l({ ru: "Статус", en: "Status" }), type: "select", options: optionsOf(OUTLET_STATUS, ctx.locale), width: "160px" },
            {
              field: "recentValue",
              label: ctx.l({
                ru: months.length ? `Продажи ${monthLabel(months[0])}–${monthLabel(months.at(-1)!)}` : "Продажи",
                en: months.length ? `Sales ${monthLabel(months[0])}–${monthLabel(months.at(-1)!)}` : "Sales",
              }),
              type: "number",
              readOnly: true,
              width: "130px",
            },
            { field: "creditDays", label: ctx.l({ ru: "Отсрочка, дн.", en: "Credit, days" }), type: "number", nullable: true, width: "90px" },
            { field: "contact", label: ctx.l({ ru: "Контакт", en: "Contact" }), type: "text", width: "140px" },
            { field: "phone", label: ctx.l({ ru: "Телефон", en: "Phone" }), type: "text", width: "120px" },
            { field: "contractNo", label: ctx.l({ ru: "№ договора", en: "Contract no." }), type: "text", width: "100px" },
            { field: "signedDate", label: ctx.l({ ru: "Подписан", en: "Signed" }), type: "date", width: "130px" },
            { field: "firstOrderDate", label: ctx.l({ ru: "Первый заказ TI", en: "First TI order" }), type: "date", width: "130px" },
            { field: "notes", label: ctx.l({ ru: "Заметки", en: "Notes" }), type: "text", width: "180px" },
          ]}
          emptyLabel={ctx.l({
            ru: "Реестр пуст. «Добавить клиентов из 1С» соберёт точки из продаж Fargo за полгода.",
            en: "The register is empty. «Add clients from 1C» builds it from Fargo's sales of the last six months.",
          })}
        />
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {ctx.l({
          ru: "Продажи — отгрузки Fargo точке по 1С за последние месяцы с данными по клиентам, по ценам справочника с НДС.",
          en: "Sales are Fargo's 1C shipments to the outlet over the latest months with client data, at list prices incl. VAT.",
        })}
      </p>
    </>
  );
}
