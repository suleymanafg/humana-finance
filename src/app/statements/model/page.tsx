import { pageContext, type SearchParams } from "@/lib/page-context";
import { ButtonLink, SectionTitle, Toolbar } from "@/components/statement";
import { modelContents, modelSheetName } from "@/lib/model-workbook";

// The whole model as one live-formula Excel, up to the month in the header — the download in either language and
// what each tab holds (the same list as the workbook's «Contents» tab).
export default async function ModelPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await pageContext(sp.month);
  const href = (locale: "ru" | "en") => `/api/export/model?month=${ctx.monthId}&locale=${locale}`;
  return (
    <>
      <Toolbar>
        <p className="text-[13px] text-muted">
          {ctx.l({
            ru: `Вся модель одним файлом Excel, по ${ctx.monthId}. Каждая цифра в отчётах — формула из листов с данными; лист «Сверка с приложением» показывает, что всё совпадает с приложением.`,
            en: `The whole model as one Excel file, to ${ctx.monthId}. Every figure in the statements is a formula over the data tabs; the «App check» tab shows it all equals the app.`,
          })}
        </p>
        <div className="ml-auto flex gap-2">
          <ButtonLink href={href("ru")}>{ctx.l({ ru: "Скачать на русском", en: "Download in Russian" })}</ButtonLink>
          <ButtonLink href={href("en")}>{ctx.l({ ru: "Скачать на английском", en: "Download in English" })}</ButtonLink>
        </div>
      </Toolbar>
      {modelContents(false).map((group) => (
        <section key={group.name[1]}>
          <SectionTitle>{ctx.l({ ru: group.name[0], en: group.name[1] })}</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-[13px]">
              <tbody>
                {group.tabs.map(([key, ru, en]) => (
                  <tr key={key} className="border-b border-border last:border-b-0">
                    <td className="w-64 px-4 py-2 font-medium">{modelSheetName(key, ctx.locale)}</td>
                    <td className="px-4 py-2 text-muted">{ctx.l({ ru, en })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
