import type { FocusEvent } from "react";
import { BIRTH_MONTHS, birthYearBounds } from "@/lib/birth-calendar";

export function BirthFields({
  required = false,
  defaultMonth,
  defaultYear,
  monthId = "birth_month",
  yearId = "birth_year",
  onFocus,
}: {
  required?: boolean;
  defaultMonth?: number | null;
  defaultYear?: number | null;
  monthId?: string;
  yearId?: string;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
}) {
  const { min, max } = birthYearBounds();
  return (
    <>
      <div>
        <label htmlFor={monthId} className="label">Birth month</label>
        <select id={monthId} name="birth_month" required={required} className="input" defaultValue={defaultMonth ?? ""} onFocus={onFocus}>
          <option value="">{required ? "Month" : "Not set"}</option>
          {BIRTH_MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>{name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={yearId} className="label">Birth year</label>
        <input
          id={yearId}
          name="birth_year"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          required={required}
          defaultValue={defaultYear ?? undefined}
          className="input"
          placeholder="2018"
          onFocus={onFocus}
        />
      </div>
    </>
  );
}
