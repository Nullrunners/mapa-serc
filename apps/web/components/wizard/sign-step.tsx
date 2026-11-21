import type { Ref } from "react";
import { StepButtons, StepHeading, type Licence, type Provider } from "./shared";

const LICENCES: { value: Licence; label: string; hint: string }[] = [
  { value: "CC0 1.0", label: "Bez żadnych warunków (CC0 1.0)", hint: "Polecamy dla danych publicznych: każdy może z nich swobodnie korzystać." },
  { value: "CC BY 4.0", label: "Z obowiązkiem podania źródła (CC BY 4.0)", hint: "Kto użyje tych danych, musi podać Twoją instytucję jako źródło." },
];

export interface SignStepProps {
  headingRef: Ref<HTMLHeadingElement>;
  provider: Provider;
  onProvider: (provider: Provider) => void;
  /** The provider came with an operator's invitation, so the data goes live at once. */
  invitation: boolean;
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

export default function SignStep({ headingRef, provider, onProvider, invitation, busy, onBack, onSubmit }: SignStepProps) {
  const set = (change: Partial<Provider>) => onProvider({ ...provider, ...change });
  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <StepHeading headingRef={headingRef}>Podpisz zgłoszenie</StepHeading>
      {invitation && <p className="rounded-lg bg-gov-light p-3 text-sm">Dostałeś(-aś) zaproszenie od administratora zbioru, więc po wysłaniu dane pojawią się od razu.</p>}

      <div className="space-y-1.5">
        <label htmlFor="dostawca" className="label">
          Nazwa instytucji
        </label>
        <p id="dostawca-opis" className="hint">
          Pokażemy ją przy każdym urządzeniu jako źródło danych, na przykład „Urząd Miasta Marki”.
        </p>
        <input
          id="dostawca"
          required
          minLength={2}
          maxLength={200}
          autoComplete="organization"
          aria-describedby="dostawca-opis"
          value={provider.name}
          onChange={(event) => set({ name: event.target.value })}
          className="field w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="label">
          Adres e-mail instytucji <span className="font-normal text-muted">(nieobowiązkowy)</span>
        </label>
        <p id="email-opis" className="hint">
          Wyślemy tu naklejki z kodem QR dla Twoich urządzeń i przypomnimy o wymianie elektrod i baterii przed terminem. Nie pokazujemy tego adresu publicznie.
        </p>
        <input id="email" type="email" autoComplete="email" aria-describedby="email-opis" value={provider.email} onChange={(event) => set({ email: event.target.value })} className="field w-full" />
      </div>

      <fieldset className="space-y-3">
        <legend className="label">Na jakich warunkach udostępniasz dane?</legend>
        {LICENCES.map((option) => (
          <label key={option.value} className="flex items-start gap-3">
            <input type="radio" name="licencja" value={option.value} checked={provider.licence === option.value} onChange={() => set({ licence: option.value })} className="mt-1 size-4" />
            <span>
              {option.label}
              <span className="hint block">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex items-start gap-3">
        <input type="checkbox" required checked={provider.confirmed} onChange={(event) => set({ confirmed: event.target.checked })} className="mt-1 size-4" />
        <span>Potwierdzam, że mogę udostępnić te dane i że nie ma w nich danych prywatnych osób, takich jak numery telefonów komórkowych czy imienne adresy e-mail.</span>
      </label>

      <StepButtons onBack={onBack}>
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Wysyłam…" : "Wyślij zgłoszenie"}
        </button>
      </StepButtons>
    </form>
  );
}
