import { resolveLang } from "../localize";
import { ukrainianCardDescriptions } from "../translations/uk-card-descriptions";
import type { HomeAssistant } from "../types";

interface CardPickerEntry {
  type: string;
  description?: string;
}

type HomeAssistantRoot = HTMLElement & { hass?: Pick<HomeAssistant, "locale" | "language"> };

export function localizeCardPickerDescriptions(): void {
  const { customCards } = window as Window & { customCards?: CardPickerEntry[] };
  for (const card of customCards ?? []) {
    const ukrainian = ukrainianCardDescriptions.get(card.type);
    if (!ukrainian) continue;
    const original = Object.getOwnPropertyDescriptor(card, "description");
    if (!original?.configurable || typeof original.value !== "string") continue;

    // The picker reads the registry when it opens, after the profile is ready.
    const fallback = card.description;
    Object.defineProperty(card, "description", {
      configurable: true,
      enumerable: original.enumerable,
      get() {
        const hass = document.querySelector<HomeAssistantRoot>("home-assistant")?.hass;
        return resolveLang(hass?.locale?.language ?? hass?.language) === "uk" ? ukrainian : fallback;
      },
      set(value: string | undefined) {
        Object.defineProperty(card, "description", { ...original, value });
      },
    });
  }
}
