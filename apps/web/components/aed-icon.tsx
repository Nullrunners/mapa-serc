import type { ExpressionSpecification } from "maplibre-gl";
import { ACCESS_LABEL } from "@/lib/aed-text";

/**
 * Who can reach a device, as the map shows it: the colour of its icon, in the order of the legend. Devices out of
 * service are red whoever may use them; those whose source says nothing about access are grey. The icon is drawn
 * above the others the higher it is on this list, so a device anyone can take is never hidden under one they cannot.
 *
 * Red and green, or grey and green, look alike to many people who do not see colours well, so those two kinds also
 * carry a badge in the corner: a cross for out of service, a question mark for unknown access (WCAG 1.4.1).
 */
export const AED_KINDS = [
  { id: "publiczny", color: "#00873e", glyph: "#ffffff", label: ACCESS_LABEL.publiczny, badge: null },
  { id: "ograniczony", color: "#f2b705", glyph: "#1b1b1b", label: ACCESS_LABEL.ograniczony, badge: null },
  { id: "prywatny", color: "#1f6fc5", glyph: "#ffffff", label: ACCESS_LABEL.prywatny, badge: null },
  { id: "niedostepny", color: "#c62828", glyph: "#ffffff", label: "niedostępny", badge: "cross" },
  { id: "nieznany", color: "#6b7280", glyph: "#ffffff", label: "dostęp nieznany", badge: "question" },
] as const;

export type AedKind = (typeof AED_KINDS)[number];

/** The same choice as a MapLibre expression over a record's `status` and `dostep`. */
const KIND: ExpressionSpecification = [
  "case",
  ["in", ["get", "status"], ["literal", ["czasowo_niedostepny", "wycofany"]]],
  "niedostepny",
  ["match", ["get", "dostep"], ["publiczny", "ograniczony", "prywatny"], ["get", "dostep"], "nieznany"],
];

export const aedImageId = (kind: AedKind) => `aed-${kind.id}`;
/** The name of the device's image, for `icon-image`. */
export const AED_ICON_IMAGE: ExpressionSpecification = ["concat", "aed-", KIND];
/** For `symbol-sort-key`: the first kind on the list gets the highest key and is drawn on top. */
export const AED_ICON_ORDER: ExpressionSpecification = ["match", KIND, ...AED_KINDS.flatMap((kind, index) => [kind.id, AED_KINDS.length - index]), 0] as ExpressionSpecification;

// The usual sign for a defibrillator, on a 24 × 24 grid: a heart crossed by a lightning bolt, with a small cross by it,
// on a rounded square in the colour of the kind.
const SQUARE = "M6 1h12a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5H6a5 5 0 0 1-5-5V6a5 5 0 0 1 5-5z";
const HEART = "M10.5 19.75C6 16.75 3.5 13.875 3.5 10.875 3.5 8.725 5.225 7 7.375 7c1.35 0 2.5.7 3.125 1.75.625-1.05 1.775-1.75 3.125-1.75 2.15 0 3.875 1.725 3.875 3.875 0 3-2.5 5.875-7 8.875z";
const BOLT = "M11.375 8.75 8 14h2.375L9.5 18.25l3.5-5.5h-2.375z";
const CROSS = "M18.2 2.8h1.6v1.4h1.4v1.6h-1.4v1.4h-1.6V5.8h-1.4V4.2h1.4z";

// The badge: a white disc over the bottom right corner, clear of the heart, with a dark mark drawn in lines.
const BADGE = { x: 18.6, y: 18.6, r: 4.6 };
const INK = "#1b1b1b";
const BADGE_MARKS: Record<NonNullable<AedKind["badge"]>, { lines: string; dot: boolean }> = {
  cross: { lines: "M16.9 16.9l3.4 3.4m0-3.4-3.4 3.4", dot: false },
  question: { lines: "M17.2 17.6a1.45 1.45 0 1 1 2.2 1.25c-.5.3-.8.6-.8 1.15", dot: true },
};
const BADGE_DOT = { x: 18.6, y: 21.45, r: 0.75 };

/** The icon for the legend, in place of a coloured dot. */
export function AedIcon({ kind, size = 20 }: { kind: AedKind; size?: number }) {
  const mark = kind.badge && BADGE_MARKS[kind.badge];
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className="shrink-0">
      <path d={SQUARE} fill={kind.color} stroke="#ffffff" strokeWidth={1.5} />
      <path d={HEART} fill={kind.glyph} />
      <path d={BOLT} fill={kind.color} />
      <path d={CROSS} fill={kind.glyph} />
      {mark && (
        <>
          <circle cx={BADGE.x} cy={BADGE.y} r={BADGE.r} fill="#ffffff" stroke={INK} strokeWidth={0.8} />
          <path d={mark.lines} fill="none" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
          {mark.dot && <circle cx={BADGE_DOT.x} cy={BADGE_DOT.y} r={BADGE_DOT.r} fill={INK} />}
        </>
      )}
    </svg>
  );
}

/**
 * The icon for the map, 36 px so it stands out among the shops and stops of the base map. It is drawn twice as large
 * as it is shown, so it stays sharp on dense screens: add it with `pixelRatio: 2`.
 */
export function aedImage(kind: AedKind): ImageData | null {
  const size = 2 * 36;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(size / 24, size / 24);
  const square = new Path2D(SQUARE);
  context.fillStyle = kind.color;
  context.fill(square);
  context.lineWidth = 1.5;
  context.strokeStyle = "#ffffff";
  context.stroke(square);
  context.fillStyle = kind.glyph;
  context.fill(new Path2D(HEART));
  context.fill(new Path2D(CROSS));
  context.fillStyle = kind.color;
  context.fill(new Path2D(BOLT));
  const mark = kind.badge && BADGE_MARKS[kind.badge];
  if (mark) {
    context.beginPath();
    context.arc(BADGE.x, BADGE.y, BADGE.r, 0, 2 * Math.PI);
    context.fillStyle = "#ffffff";
    context.fill();
    context.lineWidth = 0.8;
    context.strokeStyle = INK;
    context.stroke();
    context.lineWidth = 1.4;
    context.lineCap = "round";
    context.stroke(new Path2D(mark.lines));
    if (mark.dot) {
      context.beginPath();
      context.arc(BADGE_DOT.x, BADGE_DOT.y, BADGE_DOT.r, 0, 2 * Math.PI);
      context.fillStyle = INK;
      context.fill();
    }
  }
  return context.getImageData(0, 0, size, size);
}
