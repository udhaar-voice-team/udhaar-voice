"use client";

import { ArrowRight, Mic, SendHorizontal, Sparkles, Square, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AiProgress } from "@/components/app/ai-progress";
import { PageHeader } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import type { AskAnswer } from "@/lib/api/contract";
import { attempt, useApiMutation, useCustomers, useReminderCandidates } from "@/lib/api/hooks";
import { untilAnswered } from "@/lib/api/steps";
import { toWav } from "@/lib/audio";
import { useLeaveWarning } from "@/hooks/use-leave-warning";
import { useNow } from "@/hooks/use-now";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Message = { id: number; role: "user"; text: string; spoken?: boolean } | { id: number; role: "assistant"; answer: AskAnswer };

/** The language of a question's script, so it gets the right font; Latin text has none. */
const scriptLang = (s: string) => (/[ঀ-৿]/.test(s) ? "bn" : /[ଁ-୷]/.test(s) ? "or" : /[ऀ-ॿ]/.test(s) ? "hi" : undefined);

export function AskScreen() {
  const t = useT().ask;
  const customers = useCustomers();
  const candidates = useReminderCandidates();
  // Examples with names come from this shop: who owes the most, and someone Asha can call now.
  const owesMost = [...(customers.data ?? [])].filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance)[0];
  const callable = (candidates.data ?? []).find((c) => c.eligible);
  const suggestions = [
    ...t.suggestions.slice(0, 1),
    ...(owesMost ? [t.suggestOwes(owesMost.customer.name)] : []),
    ...t.suggestions.slice(1),
    ...(callable ? [t.suggestCall(callable.customer.name)] : []),
  ];
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  // Whether a second model has taken over the current question or recording.
  const [backup, setBackup] = useState(false);
  const onNext = () => setBackup(true);
  const ask = useApiMutation((question: string) => untilAnswered((provider) => api.ask(question, provider), onNext));
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, ask.isPending]);

  const send = async (question: string, spoken = false) => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    setText("");
    setBackup(false);
    setMessages((m) => [...m, { id: nextId.current++, role: "user", text: q, spoken }]);
    const answered = await attempt(ask.mutateAsync(q));
    if (answered) setMessages((m) => [...m, { id: nextId.current++, role: "assistant", answer: answered.value }]);
  };

  const voice = useVoiceRecorder();
  const transcribe = useApiMutation(
    async (clip: Blob) => {
      const audio = await toWav(clip);
      return untilAnswered((provider) => api.transcribe(audio, provider), onNext);
    },
    { quiet: true },
  );
  const busy = ask.isPending || transcribe.isPending;
  useLeaveWarning(busy);

  const toggleVoice = async () => {
    if (voice.recordingSince) return voice.stop();
    // The text box is locked while recording, so what's typed now is what's there when the words arrive.
    const typed = text.trim();
    const started = await voice.start(async (audio) => {
      setBackup(false);
      try {
        const heard = await transcribe.mutateAsync(audio);
        // Spoken words go after anything already typed, for the shopkeeper to check and send.
        if (typed) setText(`${typed} ${heard.text}`);
        else await send(heard.text, true);
      } catch {
        toast.error(t.voiceFailed);
      }
    });
    if (started === "denied") toast.error(t.voiceDenied);
    if (started === "unsupported") toast.error(t.voiceUnsupported);
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t.title} description={t.description} />
      <Card className="overflow-hidden">
        <CardContent className="flex min-h-[28rem] flex-col gap-4 p-0">
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pt-4 sm:px-6">
            <Bubble role="assistant">
              <p>{t.intro}</p>
            </Bubble>
            {messages.map((m) =>
              m.role === "user" ? (
                <Bubble key={m.id} role="user">
                  {m.spoken ? (
                    <span className="flex items-center gap-1 text-[11px] opacity-80">
                      <Mic className="size-3" /> {t.spoken}
                    </span>
                  ) : null}
                  <p lang={scriptLang(m.text)}>{m.text}</p>
                </Bubble>
              ) : (
                <Bubble key={m.id} role="assistant">
                  <AnswerBody answer={m.answer} />
                </Bubble>
              ),
            )}
            {transcribe.isPending ? (
              <Bubble role="user">
                <AiProgress label={t.transcribing} backup={backup} slowAfter={10} className="[&_*]:text-primary-foreground" />
              </Bubble>
            ) : null}
            {ask.isPending ? (
              <Bubble role="assistant">
                <AiProgress label={t.thinking} backup={backup} slowAfter={12} />
              </Bubble>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="space-y-3 border-t bg-muted/30 px-4 py-4 sm:px-6">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={busy}
                  className="h-8 shrink-0 rounded-full border bg-card px-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            {voice.recordingSince ? <Listening since={voice.recordingSince} maxSeconds={voice.maxSeconds} /> : null}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    id="ask-voice"
                    size="icon-lg"
                    variant={voice.recordingSince ? "destructive" : "outline"}
                    disabled={busy}
                    onClick={() => void toggleVoice()}
                    aria-label={voice.recordingSince ? t.voiceStop : t.voice}
                    aria-pressed={!!voice.recordingSince}
                  >
                    {voice.recordingSince ? <Square /> : <Mic />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{voice.recordingSince ? t.voiceStop : t.voiceNote}</TooltipContent>
              </Tooltip>
              <Input
                id="ask-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t.placeholder}
                className="h-9 flex-1"
                autoComplete="off"
                readOnly={!!voice.recordingSince || transcribe.isPending}
              />
              <Button type="submit" size="lg" disabled={!text.trim() || busy || !!voice.recordingSince}>
                <SendHorizontal /> {t.send}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Shown above the text box while the microphone is on. */
function Listening({ since, maxSeconds }: { since: number; maxSeconds: number }) {
  const t = useT().ask;
  const now = useNow(250);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 text-sm" role="status">
      <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden />
      <span className="font-medium">{t.listening(`0:${String(seconds).padStart(2, "0")}`)}</span>
      <span className="hidden truncate text-xs text-muted-foreground sm:inline">{t.listeningHint(maxSeconds)}</span>
    </div>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const t = useT().ask;
  const assistant = role === "assistant";
  return (
    <div className={cn("flex gap-3", assistant ? "justify-start" : "justify-end")}>
      {assistant ? (
        <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-label={t.assistant}>
          <Sparkles className="size-4" />
        </span>
      ) : null}
      <div className={cn("max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm sm:max-w-[70%]", assistant ? "rounded-tl-sm bg-accent" : "rounded-tr-sm bg-primary text-primary-foreground")}>
        {children}
      </div>
    </div>
  );
}

function AnswerBody({ answer }: { answer: AskAnswer }) {
  const t = useT().ask;
  return (
    <>
      {answer.tool !== "none" ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <Wrench className="size-3" /> {t.calledTool} <code className="rounded bg-background/70 px-1">{answer.tool}</code>
        </p>
      ) : null}
      <p className="text-[0.95rem]">{answer.answer}</p>
      {answer.items?.length ? (
        <ul className="divide-y rounded-lg border bg-background">
          {answer.items.map((item, i) => {
            const row = (
              <>
                <span className="font-medium">{item.label}</span>
                {item.value ? <span className="text-right text-muted-foreground">{item.value}</span> : null}
              </>
            );
            return (
              <li key={i}>
                {item.href ? (
                  <Link href={item.href} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/50">
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3 py-2">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {answer.action ? (
        <Button asChild size="sm" variant="outline" className="bg-background">
          <Link href={answer.action.href}>
            {answer.action.label} <ArrowRight />
          </Link>
        </Button>
      ) : null}
    </>
  );
}
