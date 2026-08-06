// AI analyst endpoint. Streams NDJSON lines to the client:
//   {t:"text", d}      — a chunk of assistant text
//   {t:"tool", label}  — a tool is about to run (shown as an activity chip)
//   {t:"done"} / {t:"error", message}
//
// The model runs a read-only tool loop server-side; the conversation history
// the client sends is plain text only, so nothing model-internal (thinking,
// tool payloads) ever round-trips through the browser.
import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";
import { getComputed } from "@/lib/data";
import {
  AI_TOOLS,
  AI_WRITE_TOOLS,
  TOOL_LABELS,
  WRITE_TOOL_NAMES,
  runAiTool,
  runAiWriteTool,
} from "@/lib/ai/tools";
import { ADMIN_WRITE_RULES, SYSTEM_PROMPT, VIEWER_RULES } from "@/lib/ai/prompt";

// The tool loop can take a while on a hard question; Vercel fluid compute
// allows up to 300s on this plan.
export const maxDuration = 300;

const MODEL = process.env.AI_MODEL ?? "claude-opus-5";
const MAX_TURNS = 8;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    locale?: string;
  };
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-30);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "last message must be from the user" }, { status: 400 });
  }
  const lang: "ru" | "en" = body.locale === "en" ? "en" : "ru";

  const client = new Anthropic();
  const ctx = await getComputed();
  // Write tools exist only for ADMIN sessions — a viewer's model never even
  // sees them, and the executor below re-checks the role as defense in depth.
  const isAdmin = session.role === "ADMIN";
  const tools = isAdmin ? [...AI_TOOLS, ...AI_WRITE_TOOLS] : AI_TOOLS;
  const system = SYSTEM_PROMPT + (isAdmin ? ADMIN_WRITE_RULES : VIEWER_RULES);

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const params: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
            stream: true,
            model: MODEL,
            max_tokens: 16000,
            system,
            tools: tools as unknown as Anthropic.Beta.BetaTool[],
            messages,
            betas: ["server-side-fallback-2026-07-01"],
          };
          // Server-side refusal fallback: if safety classifiers decline, the
          // API re-runs the request on the recommended fallback model instead
          // of failing the question. SDK typings lag this parameter.
          (params as unknown as Record<string, unknown>).fallbacks = "default";

          const msgStream = client.beta.messages.stream(params);

          for await (const event of msgStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ t: "text", d: event.delta.text });
            }
          }
          const response = await msgStream.finalMessage();

          if (response.stop_reason === "refusal") {
            send({
              t: "error",
              message:
                lang === "ru"
                  ? "Модель отклонила запрос. Переформулируйте вопрос."
                  : "The model declined this request. Try rephrasing.",
            });
            break;
          }

          if (response.stop_reason !== "tool_use") break;

          // run the requested tools, then continue the loop with the results
          messages.push({ role: "assistant", content: response.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            send({ t: "tool", label: TOOL_LABELS[block.name]?.[lang] ?? block.name });
            let result: unknown;
            try {
              const toolInput = (block.input ?? {}) as Record<string, unknown>;
              if (WRITE_TOOL_NAMES.has(block.name)) {
                result = isAdmin
                  ? await runAiWriteTool(block.name, toolInput, session.username)
                  : { error: "запись доступна только администратору" };
              } else {
                result = await runAiTool(ctx, block.name, toolInput);
              }
            } catch (e) {
              result = { error: e instanceof Error ? e.message : "tool failed" };
            }
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
          messages.push({ role: "user", content: results });
        }
        send({ t: "done" });
      } catch (e) {
        send({
          t: "error",
          message:
            e instanceof Anthropic.APIError
              ? `API error ${e.status}: ${e.message}`
              : lang === "ru"
                ? "Что-то пошло не так. Попробуйте ещё раз."
                : "Something went wrong. Try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}
