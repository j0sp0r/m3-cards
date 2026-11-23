// Types for the unit test that keeps the "New" view on the current release.
export declare const WHATS_NEW: {
  version: string;
  date: string;
  summary: { en: string; de: string };
  counts: { cards: number; features: number };
  sections: (t: (en: string, de: string) => string) => [string, Record<string, unknown>[]][];
};
