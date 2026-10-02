import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import type { ArtifactBlueprint } from "@eco/contracts";
import type { ChildRow, TopicRow } from "@eco/db";
import { retryTopicGeneration } from "@/app/actions";
import { withTouchGuards } from "@eco/learnkit";
import { ArtifactPlayer } from "@/components/artifact-player";
import { ArrowLeft } from "@/components/icons";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { GeneratingState } from "@/components/generating-state";
import { isKidMode, requireLearner } from "@/lib/auth";
import { ensureArtifact, prewarmNextTopic } from "@/lib/jobs";
import { createClient } from "@/lib/supabase/server";

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
  const blocked = billingCode(sp.billing);
  if (blocked) {
    return (
      <div className="py-4">
        <TopicHeader title={t.title} backHref={backHref} />
        <BillingNotice code={blocked} audience={kid ? "learner" : "grownup"} />
      </div>
    );
  }

  const artifact = await ensureArtifact(t.id);
  if (!artifact.ok) {
    return (
      <div className="py-4">
        <TopicHeader title={t.title} backHref={backHref} />
        <BillingNotice code={artifact.error} audience={kid ? "learner" : "grownup"} />
      </div>
    );
  }
  const art = artifact.artifact;
  const emoji = art?.blueprint ? (art.blueprint as ArtifactBlueprint).theme?.emoji : undefined;

  if (!art || art.status !== "published" || !art.html) {
    return (
      <div className="py-4">
        <TopicHeader title={t.title} backHref={backHref} />
        <GeneratingState topicId={t.id} emoji="✨" failed={art?.status === "failed" ? art.error : null} retry={retryTopicGeneration.bind(null, c.id, t.id)} />
      </div>
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

  return (
    <div className="py-4">
      <TopicHeader title={t.title} backHref={backHref} emoji={emoji} />
      <ArtifactPlayer html={withTouchGuards(art.html)} sessionId={session.id as string} nonce={nonce} topicId={t.id} artifactId={art.id} title={t.title} backHref={backHref} />
    </div>
  );
}

function TopicHeader({ title, backHref, emoji }: { title: string; backHref: string; emoji?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Link href={backHref} className="btn-secondary btn-sm">
        <ArrowLeft size={15} />
        Back to path
      </Link>
      <h1 className="flex min-w-0 items-center gap-2 text-base font-extrabold text-ink-soft">
        {emoji ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-lg shadow-soft" aria-hidden>
            {emoji}
          </span>
        ) : null}
        <span className="truncate">{title}</span>
      </h1>
    </div>
  );
}
