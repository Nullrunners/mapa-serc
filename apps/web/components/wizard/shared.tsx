import type { ReactNode, Ref } from "react";
import type { components } from "@/lib/api/schema";

export type Preview = components["schemas"]["ImportPreview"];
export type Result = components["schemas"]["ImportResult"];
/** Column of the file → field of the pattern (or a composite such as "adres"); null skips the column. */
export type Mapping = Record<string, string | null>;
export type Licence = "CC0 1.0" | "CC BY 4.0";

export interface Provider {
  name: string;
  email: string;
  licence: Licence;
  confirmed: boolean;
}

/** Each step starts at its heading; the wizard moves the focus there, so a screen reader says where the person is. */
export function StepHeading({ headingRef, children }: { headingRef: Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold">
      {children}
    </h2>
  );
}

/** "Wstecz" and the way forward, at the end of a step. */
export function StepButtons({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      <button type="button" onClick={onBack} className="btn btn-secondary">
        Wstecz
      </button>
      {children}
    </div>
  );
}

/** A cell of the file as it came; an empty one shows as a dash. */
export const cell = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
