import type { AedItem } from "@/lib/api/client";
import { date } from "@/lib/aed-text";
import { REPORT_TEXT, dateTime, expiryText, reportedBy, type PassportPublic } from "@/lib/passport-text";

/**
 * What the passport says about a device, for the device panel: open problems first, then who confirmed it.
 * A device known only from OpenStreetMap keeps its warning until its keeper or a passer-by confirms it.
 * `passport` is null when it could not be loaded; the panel then says what it said before there were passports.
 */
export default function PassportNote({ publication, passport }: { publication: AedItem["publication"]; passport: PassportPublic | null }) {
  const problems = passport?.reports.problems ?? [];
  const expired = passport?.items.filter((entry) => entry.state === "expired") ?? [];
  const byKeeper = passport?.confirmedByKeeper ? passport.confirmedAt : null;
  const lastOk = passport?.reports.lastOk ?? null;
  // Good news is green only when nothing above it says the device may not work.
  const good = problems.length || expired.length ? "" : "text-ok";

  const lines: { key: string; text: string; tone: string }[] = [
    ...problems.map((problem) => ({
      key: problem.kind,
      text: `Zgłoszono: ${REPORT_TEXT[problem.kind]}${reportedBy(problem.count)}, ostatnio ${dateTime(problem.lastAt)}.`,
      tone: "font-semibold text-danger",
    })),
    ...expired.map((entry) => ({
      key: entry.item,
      text: `${entry.label[0]!.toUpperCase() + entry.label.slice(1)}: ${expiryText(entry).text}.`,
      tone: "text-danger",
    })),
  ];
  if (byKeeper) lines.push({ key: "keeper", text: `Opiekun potwierdził sprawność: ${date(byKeeper)}.`, tone: good });
  if (lastOk) lines.push({ key: "ok", text: `Ostatnio ktoś sprawdził, że jest na miejscu: ${dateTime(lastOk)}.`, tone: good });
  if (publication === "community") {
    lines.push(
      byKeeper || lastOk
        ? { key: "source", text: "Dane pochodzą z OpenStreetMap i nikt z instytucji ich jeszcze nie potwierdził.", tone: "text-warn" }
        : { key: "source", text: "To urządzenie nie zostało jeszcze potwierdzone. Pochodzi z OpenStreetMap, więc informacje mogą być nieaktualne.", tone: "font-semibold text-warn" },
    );
  }

  const [only] = lines;
  if (!only) return null;
  if (lines.length === 1) return <p className={`text-sm ${only.tone}`}>{only.text}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((line) => (
        <li key={line.key} className={line.tone}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}
