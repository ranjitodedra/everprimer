// One-off: rebuild topic_progress from stored learning_events. Delete after running.
import { rebuildTopicProgress } from "@/lib/progress";
import { createServiceClient } from "@/lib/supabase/server";

const db = createServiceClient();
const pairs = new Map<string, { child: string; topic: string }>();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("learning_events").select("child_id, topic_id").order("occurred_at").range(from, from + 999);
  if (error) throw error;
  for (const r of data ?? []) pairs.set(`${r.child_id}:${r.topic_id}`, { child: r.child_id as string, topic: r.topic_id as string });
  if (!data || data.length < 1000) break;
}
console.log(`rebuilding ${pairs.size} child/topic pairs`);
let ok = 0;
for (const { child, topic } of pairs.values()) {
  try {
    if (await rebuildTopicProgress(child, topic)) ok += 1;
  } catch (err) {
    console.error(child, topic, err instanceof Error ? err.message : err);
  }
}
console.log(`done: ${ok} of ${pairs.size}`);
