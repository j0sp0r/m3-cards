// Assembles README.md and README.de.md from docs/README.template.md /
// docs/README.de.template.md + docs/cards/*.md / docs/cards/*.de.md.
// Pure mechanical merge, no LLM involved — run after editing any card doc.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const CATEGORY_HEADINGS = {
  en: {
    energy: '🔌 Energy & power',
    climate: '🌡️ Climate & weather',
    light: '💡 Light, media & control',
    presence: '🚪 Presence & safety',
    household: '🧺 Household & planning',
    system: '🛠️ System & maintenance',
    special: '🐠 Special',
    layout: '🧱 Layout',
  },
  de: {
    energy: '🔌 Energie & Strom',
    climate: '🌡️ Klima & Wetter',
    light: '💡 Licht, Medien & Steuerung',
    presence: '🚪 Präsenz & Sicherheit',
    household: '🧺 Haushalt & Planung',
    system: '🛠️ System & Wartung',
    special: '🐠 Spezial',
    layout: '🧱 Layout',
  },
};
const TABLE_HEADER = {
  en: '| Card | Type | What it does |',
  de: '| Karte | Typ | Wozu |',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_HEADINGS.en);

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]+?)\n---\n\n?([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(': ');
    if (idx === -1) continue;
    fm[line.slice(0, idx)] = line.slice(idx + 2);
  }
  return { fm, body: m[2] };
}

function anchor(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s/-]/g, '').trim().replace(/\s*\/\s*/g, '--').replace(/\s+/g, '-');
}

function buildReadme(locale) {
  const suffix = locale === 'en' ? '' : `.${locale}`;
  const outFile = locale === 'en' ? 'README.md' : `README.${locale}.md`;
  const templateFile = locale === 'en' ? 'docs/README.template.md' : `docs/README.${locale}.template.md`;

  // --- load every card doc for this locale ---
  const localeFiles = readdirSync('docs/cards').filter((f) => {
    if (locale === 'en') return f.endsWith('.md') && !f.endsWith('.de.md');
    return f.endsWith(`.${locale}.md`);
  });
  const cards = localeFiles.map((f) => {
    const { fm, body } = parseFrontmatter(readFileSync(`docs/cards/${f}`, 'utf8'));
    return { ...fm, body };
  });

  // --- section order: each card doc carries its own `section_order`
  // (position of its `## Title` heading in the README), independent of
  // src/index.ts export order — which upstream does not keep in sync with
  // the README's hand-curated section order.
  const orderedCards = [...cards].sort((a, b) => Number(a.section_order) - Number(b.section_order));
  const cardCount = cards.length + cards.filter((c) => c.also_type).length;

  // --- category tables (row order follows each card's own `table_order`) ---
  const headings = CATEGORY_HEADINGS[locale];
  const categoryTables = CATEGORY_ORDER.map((key) => ({ key, heading: headings[key], entries: [] }));
  const tableByKey = new Map(categoryTables.map((t) => [t.key, t]));
  for (const card of cards) {
    tableByKey.get(card.category).entries.push({
      order: Number(card.table_order),
      row: `| [${card.display}](#${anchor(card.title)}) | \`${card.type}\` | ${card.summary} |`,
    });
    if (card.also_type) {
      tableByKey.get(card.category).entries.push({
        order: Number(card.also_table_order),
        row: `| [${card.also_display}](#${anchor(card.title)}) | \`${card.also_type}\` | ${card.also_summary} |`,
      });
    }
  }
  for (const table of categoryTables) {
    table.entries.sort((a, b) => a.order - b.order);
    table.rows = table.entries.map((e) => e.row);
  }

  const categoryTablesMd = categoryTables
    .filter((t) => t.rows.length > 0)
    .map((t) => `### ${t.heading}\n\n${TABLE_HEADER[locale]}\n| --- | --- | --- |\n${t.rows.join('\n')}`)
    .join('\n\n');

  // --- card sections, in section_order, de-duplicating combined entries ---
  const seenSlugs = new Set();
  const sectionsMd = orderedCards
    .filter((card) => {
      if (seenSlugs.has(card.title)) return false;
      seenSlugs.add(card.title);
      return true;
    })
    .map((card) => `## ${card.title}\n\n${card.body}`)
    .join('\n')
    .trimEnd();

  // --- assemble ---
  let readme = readFileSync(templateFile, 'utf8');
  // Note: replacement must be a function, not a string — a literal "$`"/"$&"/
  // "$'" inside a card doc's body (e.g. a regex example ending in `$`, right
  // before a closing backtick) is otherwise interpreted by String.replace as
  // a special substitution pattern instead of literal text.
  readme = readme.replace('{{CARD_COUNT}}', () => String(cardCount));
  readme = readme.replace('{{CATEGORY_TABLES}}', () => categoryTablesMd);
  readme = readme.replace('{{CARD_SECTIONS}}', () => sectionsMd);

  writeFileSync(outFile, readme);
  console.log(`${outFile} generated (${cardCount} cards).`);
  return cardCount;
}

let cardCount;
for (const locale of Object.keys(CATEGORY_HEADINGS)) {
  cardCount = buildReadme(locale);
}

// --- keep package.json's card count in sync (locale-independent) ---
const pkgRaw = readFileSync('package.json', 'utf8');
const pkgPatched = pkgRaw.replace(/(\d+) cards across/, `${cardCount} cards across`);
if (pkgPatched !== pkgRaw) writeFileSync('package.json', pkgPatched);
