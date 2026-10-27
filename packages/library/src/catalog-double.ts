import type { LibraryArtifactRow, LibraryArtifactVersionRow, LibraryFileEntry } from "@eco/db";
import type { SupabaseClient } from "@supabase/supabase-js";

type Filter = ["eq" | "contains" | "ilike" | "lte" | "gte", string, unknown];

export interface CatalogDoubleState {
  artifacts?: LibraryArtifactRow[];
  versions?: LibraryArtifactVersionRow[];
  rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null };
}

function rememberDraft(state: CatalogDoubleState, args: Record<string, unknown>): void {
  const manifest = args.p_manifest as { title: string; entry: string };
  const now = "2026-10-25T00:00:00.000Z";
  state.artifacts ??= [];
  state.versions ??= [];
  state.artifacts.push({
    id: String(args.p_artifact_id),
    title: manifest.title,
    owner: (args.p_actor as string | null) ?? null,
    current_version: null,
    created_at: now,
    updated_at: now,
  });
  state.versions.push({
    artifact_id: String(args.p_artifact_id),
    version: 1,
    manifest: manifest as unknown as Record<string, unknown>,
    entry_file: manifest.entry,
    files: args.p_files as LibraryFileEntry[],
    bundle_sha256: String(args.p_bundle_sha256),
    status: "draft",
    validation_report: null,
    compliance_level: args.p_compliance as 0 | 1 | 2 | 3,
    created_by: (args.p_actor as string | null) ?? null,
    created_at: now,
    published_at: null,
    published_by: null,
    retired_at: null,
  });
}

/** Just enough of the PostgREST builder for the catalog: eq/contains filters over in-memory rows, and recorded RPC calls. */
export function fakeDb(state: CatalogDoubleState) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const queries: { table: string; filters: Filter[]; limit?: number }[] = [];

  const likeNeedle = (pattern: string) => {
    let body = pattern;
    if (body.startsWith("%")) body = body.slice(1);
    if (body.endsWith("%")) body = body.slice(0, -1);
    return body.replace(/\\([\\%_])/g, "$1").toLowerCase();
  };

  const matches = (row: Record<string, unknown>, [op, col, val]: Filter) => {
    if (op === "eq") return row[col] === val;
    if (op === "ilike") {
      const needle = likeNeedle(String(val));
      const haystack = col === "manifest->>title" ? String((row.manifest as { title?: string }).title ?? "") : String(row[col] ?? "");
      return haystack.toLowerCase().includes(needle);
    }
    if (op === "lte" || op === "gte") {
      const range = (row.manifest as { ageRange?: number[] }).ageRange;
      if (!range) return false;
      const bound = col.endsWith("->0") ? range[0] : range[1];
      if (bound == null) return false;
      return op === "lte" ? bound <= Number(val) : bound >= Number(val);
    }
    const doc = row[col] as Record<string, unknown[]>;
    return Object.entries(val as Record<string, unknown[]>).every(([k, wanted]) => wanted.every((w) => doc[k]?.includes(w)));
  };

  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (!state.rpc && fn === "library_register_draft") {
        rememberDraft(state, args);
        return { data: 1, error: null };
      }
      return state.rpc?.(fn, args) ?? { data: 1, error: null };
    },
    from(table: string) {
      const q: {
        table: string;
        filters: Filter[];
        limit?: number;
        mode?: "delete" | "update";
        patch?: Record<string, unknown>;
      } = { table, filters: [] };
      queries.push(q);
      const rows = () => {
        let matched = ((table === "library_artifacts" ? state.artifacts : state.versions) ?? []).filter((r) =>
          q.filters.every((f) => matches(r as unknown as Record<string, unknown>, f)),
        );
        if (table === "library_artifact_versions") {
          const versions = matched as LibraryArtifactVersionRow[];
          matched = versions.slice().sort((a, b) => {
            const byId = a.artifact_id.localeCompare(b.artifact_id);
            return byId !== 0 ? byId : b.version - a.version;
          });
        }
        return q.limit != null ? matched.slice(0, q.limit) : matched;
      };
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => (q.filters.push(["eq", col, val]), builder),
        contains: (col: string, val: unknown) => (q.filters.push(["contains", col, val]), builder),
        ilike: (col: string, val: unknown) => (q.filters.push(["ilike", col, val]), builder),
        filter: (col: string, op: "lte" | "gte" | "ilike", val: unknown) => (q.filters.push([op, col, val]), builder),
        order: () => builder,
        limit: (n: number) => ((q.limit = n), builder),
        update: (patch: Record<string, unknown>) => ((q.mode = "update"), (q.patch = patch), builder),
        delete: () => ((q.mode = "delete"), builder),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (q.mode === "update") {
            const list = table === "library_artifacts" ? state.artifacts : state.versions;
            if (list && q.patch) {
              for (const row of list) {
                if (q.filters.every((f) => matches(row as unknown as Record<string, unknown>, f))) Object.assign(row, q.patch);
              }
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          if (q.mode === "delete") {
            const list = table === "library_artifacts" ? state.artifacts : state.versions;
            if (list) {
              for (let i = list.length - 1; i >= 0; i--) {
                const row = list[i] as unknown as Record<string, unknown>;
                if (q.filters.every((f) => matches(row, f))) list.splice(i, 1);
              }
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, rpcCalls, queries };
}
