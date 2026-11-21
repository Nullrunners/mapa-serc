"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Step, Turn } from "@/lib/route";
import { about, stepNote, stepText, type GuideWords } from "@/lib/route-text";

/** Leading the person to a device turn by turn: the banner over the map and the same thing in words in the panel. */

type Shape = "ahead" | "slight" | "bend" | "sharp" | "back" | "roundabout" | "pin";

/** Drawn for a turn to the left; a turn to the right is the same picture mirrored. */
const SHAPES: Record<Shape, ReactNode> = {
  ahead: <path d="M12 20V5M7 10l5-5 5 5" />,
  slight: <path d="M14 20v-7L7 6M7 11V6h5" />,
  bend: <path d="M16 20v-9a2 2 0 0 0-2-2H6M10 5 6 9l4 4" />,
  sharp: <path d="M15 20V8l-7 7M8 10v5h5" />,
  back: <path d="M16 20V10a4 4 0 0 0-8 0v6M5 13l3 3 3-3" />,
  roundabout: (
    <>
      <circle cx="12" cy="14" r="4" />
      <path d="M12 21v-3M12 10V3M8 7l4-4 4 4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2" />
    </>
  ),
};

const SHAPE_OF: Record<Turn, Shape> = {
  start: "ahead",
  straight: "ahead",
  "slight-left": "slight",
  "slight-right": "slight",
  left: "bend",
  right: "bend",
  "sharp-left": "sharp",
  "sharp-right": "sharp",
  back: "back",
  roundabout: "roundabout",
  arrive: "pin",
  "arrive-left": "pin",
  "arrive-right": "pin",
};

/** The arrow for a turn. It only repeats the words next to it, so screen readers skip it. */
export function TurnIcon({ turn, className = "" }: { turn: Turn; className?: string }) {
  const mirrored = turn.endsWith("right") && SHAPE_OF[turn] !== "pin";
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`${mirrored ? "-scale-x-100" : ""} ${className}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {SHAPES[SHAPE_OF[turn]]}
    </svg>
  );
}

/** On the button that starts the guidance: the arrow the person will then see as themselves on the map. */
export function GuideIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="currentColor">
      <path d="M12 3 19.5 20 12 16.5 4.5 20Z" />
    </svg>
  );
}

/**
 * What to do next, over the map, where the legend usually is. The panel says the same in words a screen reader
 * announces, so this one stays out of its way.
 */
export function GuideBanner({ words }: { words: GuideWords }) {
  return (
    <div aria-hidden className="absolute top-2 left-2 mr-12 max-w-sm overflow-hidden rounded-lg bg-gov text-white shadow-md">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {words.turn && <TurnIcon turn={words.turn} className="size-9 shrink-0" />}
        <div className="min-w-0">
          <p className="text-lg leading-tight font-bold">{words.title}</p>
          {words.note && <p className="text-sm">{words.note}</p>}
        </div>
      </div>
      {(words.then || words.left) && (
        <p className="flex flex-wrap justify-between gap-x-4 bg-gov-dark px-3 py-1.5 text-xs font-semibold">
          <span>{words.then}</span>
          <span>{words.left}</span>
        </p>
      )}
    </div>
  );
}

export interface GuidePanelProps {
  words: GuideWords;
  /** The whole way, point by point; empty while there is none. */
  steps: Step[];
  /** The point the person is walking to now, marked on the list. */
  next: Step | null;
  /** The browser stopped telling us where the person is. */
  lost: boolean;
  onStop: () => void;
}

/** The same guidance in the panel: what to do now, how much is left, the whole way as a list, and the way out. */
export function GuidePanel({ words, steps, next, lost, onStop }: GuidePanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The button that started the guidance is gone; put the keyboard (and the view, on a phone) on what replaced it.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section aria-labelledby="prowadzenie-naglowek" className="space-y-3 rounded-lg border border-l-4 border-line border-l-danger p-4">
      <h2 id="prowadzenie-naglowek" ref={heading} tabIndex={-1} className="text-sm font-semibold text-danger">
        Prowadzimy Cię do defibrylatora
      </h2>
      <div className="flex items-start gap-3">
        {words.turn && <TurnIcon turn={words.turn} className="size-8 shrink-0 text-gov" />}
        <div>
          <p className="text-lg leading-snug font-bold">{words.title}</p>
          {words.note && <p className="text-sm">{words.note}</p>}
        </div>
      </div>
      {(words.then || words.left) && <p className="text-sm">{[words.then, words.left].filter(Boolean).join(". ")}.</p>}
      <p role="status" className="sr-only">
        {words.say}
      </p>
      {lost && (
        <p role="alert" className="text-sm text-danger">
          Nie widzimy już, gdzie jesteś. Sprawdź, czy przeglądarka ma dostęp do Twojego położenia.
        </p>
      )}

      {steps.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-gov">Cała droga krok po kroku</summary>
          <ol className="mt-2 divide-y divide-line border-y border-line">
            {steps.map((step, index) => (
              <li key={index} aria-current={step === next ? "step" : undefined} className={`flex items-start gap-2 py-1.5 ${step === next ? "font-semibold" : ""}`}>
                <TurnIcon turn={step.turn} className="mt-0.5 size-5 shrink-0 text-muted" />
                <span className="flex-1">
                  {stepText(step)}
                  {stepNote(step) && <span className="block font-normal text-muted">{stepNote(step)}</span>}
                </span>
                {step.lengthM >= 1 && (
                  <span className="shrink-0 tabular-nums">
                    <span className="sr-only">potem idź </span>
                    {about(step.lengthM)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      <button type="button" onClick={onStop} className="btn btn-secondary">
        Zakończ prowadzenie
      </button>
    </section>
  );
}
