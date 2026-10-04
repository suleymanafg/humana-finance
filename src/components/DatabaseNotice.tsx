import type { DbProblem } from "@/lib/db-problem";
import type { Locale } from "@/lib/i18n";

/** Shown instead of the app when it cannot use its database. */
export default function DatabaseNotice({ problem, locale }: { problem: DbProblem; locale: Locale }) {
  const ru = locale === "ru";
  const schema = problem.kind === "schema";
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6">
        <h1 className="text-[17px] font-semibold">
          {schema
            ? ru
              ? "База данных не обновлена для этой версии"
              : "The database is not updated for this version"
            : ru
              ? "Нет связи с базой данных"
              : "The database cannot be reached"}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {schema
            ? ru
              ? "Эта версия приложения использует таблицы, которых нет в подключённой базе данных. Выполните «npx prisma db push» для базы, указанной в DATABASE_URL этого окружения, и обновите страницу."
              : "This version of the app uses tables the connected database does not have. Run “npx prisma db push” against the database in this environment's DATABASE_URL, then reload the page."
            : ru
              ? "Проверьте значение DATABASE_URL в настройках этого окружения и обновите страницу."
              : "Check the DATABASE_URL setting of this environment, then reload the page."}
        </p>
        {problem.detail && (
          <p className="mt-3 text-[12.5px] text-muted">
            {ru ? "Не найдено:" : "Missing:"} {problem.detail}
          </p>
        )}
      </div>
    </main>
  );
}
