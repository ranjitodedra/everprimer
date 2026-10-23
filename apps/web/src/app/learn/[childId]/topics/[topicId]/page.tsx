import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import type { ReactNode } from "react";
import type { ArtifactBlueprint } from "@eco/contracts";
import type { ChildRow, LessonCharacterRow, ParentRow, TopicRow } from "@eco/db";
import { retryTopicGeneration } from "@/app/actions";
import { refreshPlayerHtml, withTouchGuards } from "@eco/learnkit";
import { ArtifactPlayer } from "@/components/artifact-player";
import { ChevronRight, X } from "@/components/icons";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { GeneratingState } from "@/components/generating-state";
import { fieldFor } from "@/components/ui";
import { isKidMode, requireLearner } from "@/lib/auth";
import { ensureArtifact, prewarmNextTopic } from "@/lib/jobs";
import { characterStatusOf, ensureCharacter } from "@/lib/lesson-art";
import { liveTutorEntitled } from "@/lib/live-tutor";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TopicPlayerPage(props: PageProps<"/learn/[childId]/topics/[topicId]">) {
  const { childId, topicId } = await props.params;
  const sp = await props.searchParams;
  const account = await requireLearner(childId);
  const supabase = await createClient();

  // RLS-scoped reads double as the ownership check for the service-role calls below.
  const [{ data: child }, { data: topic }] = await Promise.all([
    supabase.from("children").select("*").eq("id", childId).maybeSingle(),
    supabase.from("topics").select("*, curricula!inner(child_id)").eq("id", topicId).eq("curricula.child_id", childId).maybeSingle(),
  ]);
  if (!child || !topic) notFound();
  const c = child as ChildRow;
  const t = topic as TopicRow;
  const backHref = `/learn/${c.id}/curricula/${t.curriculum_id}`;
  const kid = account.kind === "child" || (await isKidMode());
  const field = fieldFor(t.curriculum_id);
  const blocked = billingCode(sp.billing);
  if (blocked) {
    return (
      <Immersive backHref={backHref} field={field}>
        <BillingNotice code={blocked} audience={kid ? "learner" : "grownup"} />
      </Immersive>
    );
  }

  if (t.kind === "unit") {
    const { data: parts } = await supabase.from("topics").select("id, title").eq("parent_topic_id", t.id).order("position");
    return (
      <Immersive backHref={backHref} field={field}>
        <div className="w-full max-w-md">
          <h1 className="display text-center text-5xl">{t.title}</h1>
          <p className="mt-3 text-center opacity-75">This one comes in parts.</p>
          <ol className="mt-8 space-y-2.5">
            {(parts ?? []).map((p, i) => (
              <li key={p.id as string}>
                <Link href={`/learn/${c.id}/topics/${p.id as string}`} className="press flex min-h-16 items-center gap-4 rounded-3xl bg-paper/60 px-4">
                  <span className="display grid h-10 w-10 shrink-0 place-items-center rounded-full bg-(--field-ink) text-lg text-(--field)">{i + 1}</span>
                  <span className="min-w-0 flex-1 font-semibold">{p.title as string}</span>
                  <ChevronRight size={18} className="opacity-50" />
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </Immersive>
    );
  }

  const artifact = await ensureArtifact(t.id);
  if (!artifact.ok) {
    return (
      <Immersive backHref={backHref} field={field}>
        <BillingNotice code={artifact.error} audience={kid ? "learner" : "grownup"} />
      </Immersive>
    );
  }
  const art = artifact.artifact;
  const blueprint = art?.blueprint as ArtifactBlueprint | null | undefined;
  const emoji = blueprint?.theme?.emoji;

  if (!art || art.status !== "published" || !art.html) {
    return (
      <Immersive backHref={backHref} field={field}>
        <GeneratingState
          topicId={t.id}
          emoji={emoji ?? "✨"}
          stage={art?.status === "generating" ? art.stage : null}
          stageAt={art?.status === "generating" ? art.stage_at : null}
          retrying={art?.status === "generating" && !!art.error}
          failed={art?.status === "failed" ? (art.error ?? "failed") : null}
          retry={retryTopicGeneration.bind(null, c.id, t.id)}
        />
      </Immersive>
    );
  }

  // One session per open. The nonce lets the host reject spoofed messages.
  const nonce = randomBytes(16).toString("hex");
  const { data: session, error } = await supabase
    .from("artifact_sessions")
    .insert({ child_id: c.id, topic_id: t.id, artifact_id: art.id, nonce })
    .select("id")
    .single();
  if (error || !session) throw new Error(error?.message ?? "could not start session");

  after(() => prewarmNextTopic(t.id));

  const [{ data: progress }, characterResult, { data: owner }] = await Promise.all([
    supabase.from("topic_progress").select("sessions_completed").eq("child_id", c.id).eq("topic_id", t.id).maybeSingle(),
    supabase.from("lesson_characters").select("status, ready_at, seed, cutout").eq("topic_id", t.id).maybeSingle(),
    // Child logins cannot read the parent row; access to the child was proven above.
    createServiceClient().from("parents").select("tutor_enabled, live_tutor_allowed").eq("id", c.parent_id).maybeSingle(),
  ]);
  // Before migration 0010 the cutout column is missing; still show the stored poses.
  let characterRow = characterResult.data;
  if (characterResult.error) {
    const fallback = await supabase.from("lesson_characters").select("status, ready_at, seed").eq("topic_id", t.id).maybeSingle();
    characterRow = fallback.data ? { ...fallback.data, cutout: false } : null;
  }
  const liveTutor = liveTutorEntitled(owner as Pick<ParentRow, "tutor_enabled" | "live_tutor_allowed"> | null) === null;
  // Lessons published before characters existed get one the first time they open; a due retry runs on open too.
  if (!characterRow || characterRow.status === "queued") after(() => ensureCharacter(t.id));
  const character = characterStatusOf(characterRow as Pick<LessonCharacterRow, "status" | "ready_at" | "seed" | "cutout"> | null);
  const startSession = Math.max(0, Number((progress as { sessions_completed?: number } | null)?.sessions_completed ?? 0));

  const html = withTouchGuards(refreshPlayerHtml(art.html));
  const background = blueprint?.theme?.background;

  return (
    <ArtifactPlayer
      html={html}
      sessionId={session.id as string}
      nonce={nonce}
      topicId={t.id}
      artifactId={art.id}
      title={t.title}
      backHref={backHref}
      startSession={startSession}
      background={background}
      dark={background ? isDark(background) : false}
      character={character}
      liveTutor={liveTutor}
    />
  );
}

function isDark(hex: string): boolean {
  const n = hex.replace("#", "");
  if (n.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.45;
}

function CloseLink({ href }: { href: string }) {
  return (
    <Link href={href} className="press grid h-11 w-11 place-items-center rounded-full bg-current/10" aria-label="Close lesson">
      <X size={20} />
    </Link>
  );
}

function Immersive({ backHref, field, children }: { backHref: string; field: string; children: ReactNode }) {
  return (
    <div className={`field ${field} flex min-h-dvh flex-col`}>
      <div className="flex shrink-0 items-center px-3 pt-[max(0.5rem,env(safe-area-inset-top,0px))]">
        <CloseLink href={backHref} />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center px-5 pb-[max(3rem,env(safe-area-inset-bottom,0px))]">{children}</main>
    </div>
  );
}
