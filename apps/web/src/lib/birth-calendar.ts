export const BIRTH_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function birthYearBounds(today = new Date()): { min: number; max: number } {
  const year = today.getUTCFullYear();
  return { min: year - 120, max: year };
}
