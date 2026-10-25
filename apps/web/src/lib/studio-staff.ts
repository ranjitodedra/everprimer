import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { StaffDeps, StaffRecord } from "@/lib/studio";

/**
 * Service-role access to staff sign-ins. The signup trigger still inserts a
 * parents row. No account kind is sent, so that trigger does not insert a
 * learner, and nothing here creates a child login.
 */
export function staffDeps(): StaffDeps {
  const db = createServiceClient();
  return {
    async list() {
      const { data, error } = await db.from("staff_users").select("user_id");
      if (error) return { ok: false, message: error.message };
      const ids = (data ?? []).map((row) => String(row.user_id));
      if (ids.length === 0) return { ok: true, staff: [] };
      const accounts = await db.from("parents").select("id, email").in("id", ids);
      if (accounts.error) return { ok: false, message: accounts.error.message };
      const emailOf = new Map((accounts.data ?? []).map((row) => [String(row.id), typeof row.email === "string" ? row.email : ""]));
      const staff: StaffRecord[] = ids
        .map((userId) => ({ userId, email: emailOf.get(userId) || userId }))
        .sort((a, b) => a.email.localeCompare(b.email));
      return { ok: true, staff };
    },
    async createSignIn(input) {
      const { data, error } = await db.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: input.emailConfirm,
      });
      if (error || !data.user) return { ok: false, message: error?.message ?? "The sign-in could not be created." };
      return { ok: true, userId: data.user.id };
    },
    async deleteSignIn(userId) {
      await db.auth.admin.deleteUser(userId);
    },
    async insertStaff(userId) {
      const { error } = await db.from("staff_users").insert({ user_id: userId });
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    },
    async deleteStaff(userId) {
      const { data, error } = await db.rpc("remove_staff_member", { p_user_id: userId });
      if (error) return { ok: false, message: error.message };
      return { ok: true, removed: data === true };
    },
  };
}
