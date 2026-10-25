"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { abandonSitting, previewSitting, publishSitting } from "./actions";
import { PreviewFrame } from "./preview-frame";
import type { PreviewResult } from "@/lib/studio";

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input name={name} defaultValue={defaultValue} className="input mt-1" />
    </label>
  );
}

function TagField({ name, label, suggestions }: { name: string; label: string; suggestions: string[] }) {
  const [value, setValue] = useState("");
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input name={name} value={value} onChange={(event) => setValue(event.target.value)} className="input mt-1" placeholder="Comma-separated. A new tag is fine." />
      {suggestions.length > 0 ? (
        <select
          className="input mt-1"
          value=""
          aria-label={`Add a stored ${label.toLowerCase()} tag`}
          onChange={(event) => {
            const tag = event.target.value;
            if (!tag) return;
            setValue((current) => {
              const parts = current.split(",").map((part) => part.trim()).filter(Boolean);
              return parts.includes(tag) ? current : [...parts, tag].join(", ");
            });
          }}
        >
          <option value="">Add a stored tag</option>
          {suggestions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
      ) : null}
    </label>
  );
}

export function SittingForm({ suggestions }: { suggestions: { subjects: string[]; topics: string[]; concepts: string[] } }) {
  const draft = useRef<{ artifactId: string; version: number } | null>(null);
  const published = useRef(false);
  const [state, action, pending] = useActionState(async (prev: PreviewResult | null, formData: FormData) => {
    const previous = draft.current;
    if (previous) {
      draft.current = null;
      await abandonSitting(previous.artifactId, previous.version);
    }
    return previewSitting(prev, formData);
  }, null);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishProblems, setPublishProblems] = useState<string[]>([]);
  const preview = state?.type === "preview" ? state : null;
  useEffect(() => {
    setReady(false);
    setPublishProblems([]);
  }, [preview?.url]);
  if (published.current) draft.current = null;
  else if (preview) draft.current = { artifactId: preview.artifactId, version: preview.version };

  useEffect(() => {
    const leave = () => {
      const current = draft.current;
      if (!current) return;
      void fetch("/api/studio/abandon", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(current),
      });
      draft.current = null;
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field name="id" label="Id" />
      <Field name="title" label="Title" />
      <label className="block text-sm font-semibold sm:col-span-2">
        Description
        <textarea name="description" className="input mt-1 min-h-20" />
      </label>
      <TagField name="subjects" label="Subjects" suggestions={suggestions.subjects} />
      <TagField name="topics" label="Topics" suggestions={suggestions.topics} />
      <TagField name="concepts" label="Concepts" suggestions={suggestions.concepts} />
      <Field name="entry" label="Entry file" defaultValue="index.html" />
      <Field name="ageYoungest" label="Youngest age" />
      <Field name="ageOldest" label="Oldest age" />
      <label className="block text-sm font-semibold sm:col-span-2">
        Learning objective
        <input name="objective" className="input mt-1" />
      </label>
      <label className="block text-sm font-semibold sm:col-span-2">
        Screen reader summary
        <input name="summary" className="input mt-1" />
      </label>
      <label className="block text-sm font-semibold sm:col-span-2">
        Params
        <textarea name="params" className="input mt-1 min-h-16 font-mono text-sm" placeholder="Optional JSON list" />
      </label>
      <label className="block text-sm font-semibold sm:col-span-2">
        Events
        <textarea name="events" className="input mt-1 min-h-16 font-mono text-sm" placeholder="Optional JSON list" />
      </label>
      <label className="block text-sm font-semibold sm:col-span-2">
        Tutor guide
        <textarea name="tutorIntro" className="input mt-1 min-h-16" placeholder="Optional" />
      </label>
      <label className="block text-sm font-semibold sm:col-span-2">
        HTML
        <textarea name="html" className="input mt-1 min-h-40 font-mono text-sm" placeholder="Paste a single HTML file, or upload a ZIP" />
      </label>
      <label className="block text-sm font-semibold sm:col-span-2">
        ZIP
        <input name="zip" type="file" accept=".zip,application/zip" className="mt-1 block" />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className="btn-primary btn-sm" disabled={pending}>
          {pending ? "Checking" : "Preview"}
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={!preview || !ready || publishing}
          onClick={() => {
            if (!preview || !ready) return;
            setPublishing(true);
            void publishSitting(preview.artifactId, preview.version, true).then((result) => {
              setPublishing(false);
              if (result.type === "published") {
                published.current = true;
                draft.current = null;
                router.push(`/studio?id=${encodeURIComponent(result.artifactId)}`);
                return;
              }
              if (result.type === "refused" || result.type === "unavailable") setPublishProblems(result.problems);
            });
          }}
        >
          {publishing ? "Publishing" : "Publish"}
        </button>
        {preview ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              const current = draft.current;
              if (!current) return;
              draft.current = null;
              void abandonSitting(current.artifactId, current.version).then(() => router.push("/studio"));
            }}
          >
            Leave
          </button>
        ) : null}
      </div>
      <Notices state={state} />
      {preview ? (
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold">Compliance {preview.compliance}</p>
          <PreviewFrame url={preview.url} manifest={preview.manifest as { params?: []; events?: { name: string }[] }} onReady={setReady} />
          {publishProblems.length > 0 ? <p className="mt-3 text-sm text-berry">{publishProblems.join(" ")}</p> : null}
        </div>
      ) : null}
    </form>
  );
}

function Notices({ state }: { state: PreviewResult | null }) {
  if (!state || state.type === "preview") {
    const warnings = state?.type === "preview" ? state.warnings : [];
    if (warnings.length === 0) return null;
    return (
      <ul className="text-sm text-ink-soft sm:col-span-2">
        {warnings.map((warning) => <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>)}
      </ul>
    );
  }
  if (state.type === "invalid") {
    return (
      <ul className="text-sm sm:col-span-2">
        {state.errors.map((error) => <li key={`${error.code}-${error.message}`} className="text-berry">{error.message}</li>)}
        {state.warnings.map((warning) => <li key={`${warning.code}-${warning.message}`} className="text-ink-soft">{warning.message}</li>)}
      </ul>
    );
  }
  if (state.type === "unavailable") return <p className="text-sm text-berry sm:col-span-2">{state.problems.join(" ")}</p>;
  return null;
}
