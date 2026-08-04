// Public fill page. Rendered without the app shell (no session), mobile-first
// because it is usually opened inside Telegram's browser on a phone.
import { loadByToken, markOpened } from "@/lib/requests/service";
import { kindOf } from "@/lib/requests/kinds";
import FillForm from "@/components/FillForm";

export const dynamic = "force-dynamic";

export default async function FillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await loadByToken(token);

  if (!request) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10 text-center">
        <h1 className="font-display text-[20px] font-semibold">Ссылка недействительна</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Форма уже отправлена и принята, либо срок ссылки истёк. Свяжитесь с отправителем, чтобы
          получить новую.
        </p>
      </main>
    );
  }

  await markOpened(request.id, request.status);
  const spec = kindOf(request.kind);

  return (
    <FillForm
      token={token}
      kindLabel={spec?.labelRu ?? request.kind}
      hint={spec?.hintRu ?? ""}
      allowAddRows={spec?.allowAddRows ?? false}
      unit={spec?.unit ?? "money"}
      monthName={request.month.nameRu}
      note={request.note}
      dueDate={request.dueDate ? request.dueDate.toISOString() : null}
      alreadySubmitted={request.status === "SUBMITTED"}
      items={request.items.map((i) => ({
        id: i.id,
        label: i.label,
        freeLabel: i.freeLabel,
        priorValue: i.priorValue,
        value: i.value,
        note: i.note,
      }))}
    />
  );
}
