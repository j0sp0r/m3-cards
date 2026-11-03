/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * Every card prints "M3-<NAME>-CARD vX.Y.Z" to the console when the bundle
 * loads — the quickest answer to "which version do you run?" in a bug report.
 * Nine cards had none until 2.6.1; this walk keeps a new card from forgetting.
 *
 * Read through `import.meta.glob` for the same reason as localize.test.ts: no
 * `@types/node` needed.
 */
const SOURCES = import.meta.glob(["../m3-*.ts", "!../**/*.test.ts", "!../**/*-editor.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("version banner", () => {
  const cards = Object.entries(SOURCES)
    .map(([path, src]) => ({ path, tag: /@customElement\("(m3-[a-z0-9-]+)"\)/.exec(src)?.[1], src }))
    .filter((c): c is { path: string; tag: string; src: string } => !!c.tag);

  it("finds the cards", () => {
    expect(cards.length).toBeGreaterThanOrEqual(51);
  });

  it.each(cards.map((c) => [c.tag, c]))("%s prints its name and version", (_tag, c) => {
    const label = c.tag.toUpperCase();
    expect(c.src).toContain(`%c ${label} %c v\${CARD_VERSION}`);
  });
});
