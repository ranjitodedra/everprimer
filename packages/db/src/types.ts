/**
 * Row types for the tables in supabase/migrations. Hand-maintained for the
 * MVP; replace with `supabase gen types` output once a project is linked.
 */

export type Tier = "free" | "paid" | "max";

export type AccountKind = "individual" | "parent";

/** Columns readable by the signed-in user; PIN columns are service-role only. */
export interface ParentRow {
  id: string;
  email: string | null;
  tier: Tier;
  timezone: string;
  kind: AccountKind;
  /** Service-role writes only. Readable so the settings page can show it. */
  tutor_enabled: boolean;
  /** Grown-up switch for the live voice tutor. Readable; written by a server action. */
  live_tutor_allowed: boolean;
  /** Lesson credits still available to reserve. Readable; not client-writable. */
  credit_balance: number;
  created_at: string;
}

export type ProfileKind = "child" | "self";

export interface ChildRow {
  id: string;
  parent_id: string;
  display_name: string;
  /** Cached completed years. Recomputed from birth month and year when those are set. */
  age: number | null;
  birth_year: number | null;
  birth_month: number | null;
  reading_level: "pre_reader" | "early" | "developing" | "fluent" | "advanced" | null;
  avatar: string;
  kind: ProfileKind;
  shared_device: boolean;
  created_at: string;
}

export interface ChildLoginRow {
  user_id: string;
  child_id: string;
  parent_id: string;
  username: string;
  auth_email: string;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
}

export interface PersonalizationRow {
  id: string;
  child_id: string;
  kind: "interest" | "preference" | "note";
  value: string;
  active: boolean;
  created_at: string;
}

export type MemoryKind = "interest" | "preference" | "strength" | "misconception" | "analogy_that_worked";

export interface MemoryRow {
  id: string;
  child_id: string;
  kind: MemoryKind;
  value: string;
  source: "parent" | "inferred";
  confidence: number;
  last_seen_at: string;
  active: boolean;
  created_at: string;
}

export interface CurriculumRow {
  id: string;
  child_id: string;
  goal_text: string;
  title: string;
  description: string;
  scope: "overview" | "hobby" | "exam" | "mastery";
  scope_note: string | null;
  interest: string | null;
  status: "generating" | "ready" | "failed";
  error: string | null;
  /** Step the generation job is on; null until a worker picks it up. */
  stage: "outlining" | "saving" | null;
  stage_at: string;
  created_at: string;
  updated_at: string;
}

export interface TopicRow {
  id: string;
  curriculum_id: string;
  slug: string;
  title: string;
  description: string;
  position: number;
  difficulty: number;
  prerequisites: string[];
  /** A unit has child topics instead of a lesson of its own. */
  kind: "lesson" | "unit";
  parent_topic_id: string | null;
  created_at: string;
}

export interface ObjectiveRow {
  id: string;
  topic_id: string;
  code: string;
  text: string;
  position: number;
}

export interface ArtifactRow {
  id: string;
  topic_id: string;
  version: number;
  status: "generating" | "published" | "failed" | "split";
  blueprint: unknown | null;
  lesson_plan: unknown | null;
  html: string | null;
  used_fallback: boolean;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  validation_report: unknown | null;
  error: string | null;
  /** Step the generation job is on; null until a worker picks it up. */
  stage: "planning" | "writing" | "checking" | "building" | null;
  stage_at: string;
  created_at: string;
  published_at: string | null;
}

export interface ArtifactAssetRow {
  artifact_id: string;
  key: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  data_base64: string;
  created_at: string;
}

export type CharacterPose = "talk" | "teach";

/** One tutor character per topic, two poses in the private `lesson-art` bucket. */
export interface LessonCharacterRow {
  topic_id: string;
  parent_id: string | null;
  status: "queued" | "running" | "ready" | "failed";
  concept: string | null;
  seed: number | null;
  model: string | null;
  talk_path: string | null;
  teach_path: string | null;
  attempts: number;
  error: string | null;
  run_after: string;
  started_at: string | null;
  ready_at: string | null;
  /** Both poses are stored with a transparent background. */
  cutout: boolean;
  created_at: string;
  updated_at: string;
}

export type UsageCategory = "lesson" | "live";

/** Service role only. Amounts are credits; negative moves take from the balance. */
export interface CreditLedgerRow {
  id: string;
  parent_id: string;
  amount: number;
  kind: "grant" | "reserve" | "spend" | "refund" | "expire" | "charge";
  job_id: string | null;
  reason: string | null;
  period_start: string | null;
  category: UsageCategory | null;
  tutor_session_id: string | null;
  topic_id: string | null;
  created_at: string;
}

/** Usage metadata for one live voice session. No audio or transcript is kept. */
export interface TutorSessionRow {
  id: string;
  child_id: string;
  parent_id: string;
  topic_id: string;
  artifact_session_id: string | null;
  model: string;
  status: "issued" | "ended";
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  seconds_used: number | null;
  last_seen_at: string | null;
  credits_used: number;
  input_tokens: number;
  output_tokens: number;
}

export interface SessionRow {
  id: string;
  child_id: string;
  topic_id: string;
  artifact_id: string;
  nonce: string;
  started_at: string;
  last_event_at: string | null;
  ended_at: string | null;
}

export interface LearningEventRow {
  id: number;
  session_id: string;
  child_id: string;
  topic_id: string;
  artifact_id: string;
  client_event_id: string;
  type: string;
  section_id: string | null;
  activity_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface ResponseRow {
  id: number;
  session_id: string;
  child_id: string;
  topic_id: string;
  artifact_id: string;
  activity_id: string;
  activity_type: string;
  question_id: string;
  question_kind: string;
  difficulty: number;
  objective_codes: string[];
  answer: unknown;
  correct: boolean;
  attempt: number;
  hints_used: number;
  occurred_at: string;
}

export interface ObjectiveMasteryRow {
  child_id: string;
  objective_id: string;
  score: number;
  evidence_count: number;
  activity_types: string[];
  status: "unknown" | "developing" | "proficient" | "mastered";
  last_evidence_at: string | null;
}

export interface TopicProgressRow {
  child_id: string;
  topic_id: string;
  status: "not_started" | "in_progress" | "needs_review" | "completed";
  mastery: number;
  reached_end: boolean;
  weak_objective_codes: string[];
  first_activity_at: string | null;
  last_activity_at: string | null;
  completed_at: string | null;
  feedback: LessonFeedbackRow | null;
  sessions_completed: number;
  final_score: number | null;
}

/** End-of-lesson summary, written when the learner reaches the end. */
export interface LessonFeedbackRow {
  mastery: number;
  objectives: Array<{ code: string; text: string; status: ObjectiveMasteryRow["status"]; score: number }>;
  strong: string[];
  practice: string[];
  kid: string;
  parent: string;
}

export type JobKind = "curriculum" | "artifact" | "daily_report" | "memory";

export interface GenerationJobRow {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  error: string | null;
  usage: unknown | null;
  /** Paying account. Null on jobs created before billing. */
  parent_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  run_after: string;
}

export interface DailyReportRow {
  id: string;
  child_id: string;
  report_date: string;
  stats: Record<string, unknown>;
  summary: string;
  created_at: string;
}

/** Studio access. Readable by the user themselves; written by the service role. */
export interface StaffUserRow {
  user_id: string;
  created_at: string;
}

export interface LibraryArtifactRow {
  /** The manifest id (kebab-case); lessons store it as LibraryRef.artifactId. */
  id: string;
  title: string;
  owner: string | null;
  /** Newest published version. Null until something is published. */
  current_version: number | null;
  created_at: string;
  updated_at: string;
}

export type LibraryVersionStatus = "draft" | "testing" | "published" | "retired";

export interface LibraryFileEntry {
  path: string;
  size: number;
  sha256: string;
  mime: string;
}

/** Published rows only ever move to retired; retired rows never change. */
export interface LibraryArtifactVersionRow {
  artifact_id: string;
  version: number;
  /** An ArtifactManifest whose id and version match the row. */
  manifest: Record<string, unknown>;
  entry_file: string;
  files: LibraryFileEntry[];
  bundle_sha256: string;
  status: LibraryVersionStatus;
  validation_report: Record<string, unknown> | null;
  compliance_level: 0 | 1 | 2 | 3;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
  retired_at: string | null;
}

export type LibrarySearchDecision = "accepted" | "rejected_all" | "no_candidates";

export interface LibrarySearchLogRow {
  id: number;
  topic_id: string | null;
  artifact_id: string | null;
  bite_id: string | null;
  request: Record<string, unknown>;
  candidates: unknown[];
  decision: LibrarySearchDecision;
  chosen_artifact_id: string | null;
  chosen_version: number | null;
  created_at: string;
}

export interface LibraryUsageRow {
  id: number;
  /** The lesson artifact (artifacts.id) that pinned this library version. */
  artifact_id: string;
  bite_id: string;
  library_artifact_id: string;
  library_version: number;
  plays: number;
  created_at: string;
}
