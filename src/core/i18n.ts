import { EN } from './en';
import { store, locale } from './platform';

/**
 * Interface language. The game is written in French; `EN` translates each French text (its key) into English.
 * The language is chosen once at start (saved choice, else the player's language, English by default):
 * changing it reloads the page, so every text, even module constants, can be translated when it is created
 * (this module sets it on load, after the platform: whoever imports `t` gets the right language).
 */
export type Lang = 'fr' | 'en';
const KEY = 'manif-lang';
const saved = store.get(KEY);
export const lang: Lang = saved === 'fr' || saved === 'en' ? saved : locale().toLowerCase().startsWith('fr') ? 'fr' : 'en';

export function setLang(l: Lang) {
  if (l === lang) return;
  store.set(KEY, l);
  location.reload();
}

/** The same object with every text value translated (tables of names). */
export const tAll = <K extends string>(o: Record<K, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, t(v as string)])) as Record<K, string>;

const fill = (s: string, v: unknown[]) => s.replace(/\{(\d+)\}/g, (_m, i: string) => String(v[+i]));

/** A text in the current language: `t('Retour')`, or with values `t\`Niveau ${n}\`` (key 'Niveau {0}'). */
export function t(s: string | TemplateStringsArray, ...v: unknown[]): string {
  if (typeof s === 'string') return lang === 'en' ? EN[s] ?? s : s;
  return tk(s.reduce((a, part, i) => a + `{${i - 1}}` + part), ...v);
}

/** A key with values, the string values translated too (texts that travel between players: end of match…). */
export const tk = (key: string, ...v: unknown[]) =>
  fill(lang === 'en' ? EN[key] ?? key : key, lang === 'en' ? v.map((x) => (typeof x === 'string' ? EN[x] ?? x : x)) : v);

/**
 * A whole sentence built in French, numbers included (game messages, some sent by the host):
 * 'Interpellation réussie (3 / 13)' is looked up as 'Interpellation réussie ({0} / {1})'. Unknown texts pass as they are.
 */
export function tr(s: string): string {
  if (lang === 'fr' || !s) return s;
  if (EN[s]) return EN[s];
  const v: string[] = [];
  const key = s.replace(/\d+(?:[.,]\d+)?/g, (m) => `{${v.push(m) - 1}}`);
  return EN[key] ? fill(EN[key], v) : s;
}

/** The static page: text nodes and placeholder / title attributes whose French text has a translation. */
function translatePage() {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.nodeValue!, k = s.trim();
    if (k && EN[k]) n.nodeValue = s.replace(k, EN[k]);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[placeholder], [title]')) {
    for (const a of ['placeholder', 'title']) { const k = el.getAttribute(a); if (k && EN[k]) el.setAttribute(a, EN[k]); }
  }
  document.title = EN[document.title] ?? document.title;
}

document.documentElement.lang = lang;
if (lang === 'en') translatePage();
