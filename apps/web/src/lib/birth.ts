import { ageFromBirth } from "@eco/contracts";
import { birthYearBounds } from "@/lib/birth-calendar";

export interface BirthValue {
  birth_month: number;
  birth_year: number;
}

/** Both fields empty is allowed when birth is optional. A single field is not. */
export function parseBirth(
  formData: FormData,
  opts: { required: boolean; minAge: number; maxAge: number },
): { ok: true; birth: BirthValue | null } | { ok: false; error: string } {
  const monthRaw = String(formData.get("birth_month") ?? "").trim();
  const yearRaw = String(formData.get("birth_year") ?? "").trim();
  if (!monthRaw && !yearRaw) {
    return opts.required ? { ok: false, error: "Enter a birth month and year." } : { ok: true, birth: null };
  }
  if (!monthRaw || !yearRaw) return { ok: false, error: "Enter both a birth month and a birth year." };
  const birth_month = Number(monthRaw);
  const birth_year = Number(yearRaw);
  const { min, max } = birthYearBounds();
  if (!Number.isInteger(birth_month) || birth_month < 1 || birth_month > 12) return { ok: false, error: "Enter a real birth month." };
  if (!Number.isInteger(birth_year) || birth_year < min || birth_year > max) return { ok: false, error: "Enter a real birth year." };
  const age = ageFromBirth(birth_year, birth_month);
  if (age < opts.minAge || age > opts.maxAge) {
    return { ok: false, error: `That birthday would make the age ${age}. Use an age from ${opts.minAge} to ${opts.maxAge}.` };
  }
  return { ok: true, birth: { birth_month, birth_year } };
}
