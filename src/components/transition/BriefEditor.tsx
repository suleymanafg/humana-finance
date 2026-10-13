"use client";

// The handover's go-live date and the briefing the AI guide works from.
// Both are Settings rows (transition.goLive / transition.brief).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/locale-context";
import { crud } from "@/lib/crud-client";
import { SETTING_BRIEF, SETTING_GO_LIVE } from "@/lib/transition/model";
import { Button, Input, Modal } from "../ui";
import { TextArea } from "./TaskBoard";

export default function BriefEditor({ goLive, brief }: { goLive: string; brief: string }) {
  const { l } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(goLive);
  const [text, setText] = useState(brief);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const a = await crud("setting", "upsert", { data: { key: SETTING_GO_LIVE, value: date } });
    const b = a.error ? a : await crud("setting", "upsert", { data: { key: SETTING_BRIEF, value: text } });
    setBusy(false);
    if (b.error) {
      setError(b.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {l({ ru: "Дата запуска и брифинг", en: "Go-live date and briefing" })}
      </Button>
      {open && (
        <Modal title={l({ ru: "Дата запуска и брифинг для AI", en: "Go-live date and AI briefing" })} onClose={() => setOpen(false)} wide>
          <label className="mb-3 flex items-center gap-3">
            <span className="text-[12.5px] font-semibold text-muted">{l({ ru: "Новая структура с", en: "New structure from" })}</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <p className="mb-1.5 text-[12px] text-muted">
            {l({
              ru: "Это AI-помощник читает перед каждым ответом о переходе. Держите здесь согласованные условия и меняйте их, когда что-то решено.",
              en: "The AI assistant reads this before every answer about the handover. Keep the agreed terms here and update them as things are decided.",
            })}
          </p>
          <TextArea value={text} onChange={setText} rows={16} />
          <div className="mt-4 flex items-center justify-end gap-2">
            {error && <span className="text-[12px] text-danger">{error}</span>}
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {l({ ru: "Отмена", en: "Cancel" })}
            </Button>
            <Button onClick={save} disabled={busy}>
              {l({ ru: "Сохранить", en: "Save" })}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
