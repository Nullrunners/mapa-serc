import { TONE_TEXT } from "@/components/ui";
import type { AedItem } from "@/lib/api/client";
import { date, dateTime, type Tone } from "@/lib/format";
import { REPORT_TEXT, expiryText, partName, reportedBy, type PassportPublic } from "@/lib/passport-text";

interface Line {
  key: string;
  text: string;
  tone: Tone;
  strong?: boolean;
}

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
  const good: Tone = problems.length || expired.length ? "plain" : "ok";

  const lines: Line[] = [
    ...problems.map((problem) => ({
      key: problem.kind,
      text: `Zgłoszono: ${REPORT_TEXT[problem.kind]}${reportedBy(problem.count)}, ostatnio ${dateTime(problem.lastAt)}.`,
      tone: "danger" as const,
      strong: true,
    })),
    ...expired.map((entry) => ({ key: entry.item, text: `${partName(entry)}: ${expiryText(entry).text}.`, tone: "danger" as const })),
  ];
  if (byKeeper) lines.push({ key: "keeper", text: `Opiekun potwierdził sprawność: ${date(byKeeper)}.`, tone: good });
  if (lastOk) lines.push({ key: "ok", text: `Ostatnio ktoś sprawdził, że jest na miejscu: ${dateTime(lastOk)}.`, tone: good });
  if (publication === "community") {
    lines.push(
      byKeeper || lastOk
        ? { key: "source", text: "Dane pochodzą z OpenStreetMap i nikt z instytucji ich jeszcze nie potwierdził.", tone: "warn" }
        : { key: "source", text: "To urządzenie nie zostało jeszcze potwierdzone. Pochodzi z OpenStreetMap, więc informacje mogą być nieaktualne.", tone: "warn", strong: true },
    );
  }

  const style = (line: Line) => `${TONE_TEXT[line.tone]} ${line.strong ? "font-semibold" : ""}`;
  const [only] = lines;
  if (!only) return null;
  if (lines.length === 1) return <p className={`text-sm ${style(only)}`}>{only.text}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((line) => (
        <li key={line.key} className={style(line)}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}
