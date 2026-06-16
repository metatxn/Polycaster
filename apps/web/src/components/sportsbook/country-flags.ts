// ── Country flags ──────────────────────────────────────────────────
// National-team events (e.g. the FIFA World Cup) ship the same generic
// sport icon for every team in the upstream feed, so there's no per-team
// imagery to use. Instead we map a team's display name → ISO-3166 code and
// serve a bundled SVG from `/public/flags/` (same-origin, vector, ~1 KB,
// no image-proxy round-trip — the loader skips `/`-prefixed assets).
//
// Only national teams resolve; clubs, fighters, and esports orgs return
// null and fall back to the colored-initials avatar.

/** Normalize a name to the map's key form: lowercase, diacritics stripped,
 *  non-alphanumerics collapsed to single spaces. "Côte d'Ivoire" → "cote d ivoire". */
function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Normalized country name → flagcdn/ISO code (lowercase). Includes common
// aliases (USA, Ivory Coast, Korea Republic, Czech Republic, …) and the
// home-nations special codes (gb-eng / gb-sct / gb-wls / gb-nir).
const COUNTRY_CODES: Record<string, string> = {
  // ── UEFA ──
  albania: "al",
  andorra: "ad",
  armenia: "am",
  austria: "at",
  azerbaijan: "az",
  belarus: "by",
  belgium: "be",
  "bosnia and herzegovina": "ba",
  bosnia: "ba",
  bulgaria: "bg",
  croatia: "hr",
  cyprus: "cy",
  czechia: "cz",
  "czech republic": "cz",
  denmark: "dk",
  england: "gb-eng",
  estonia: "ee",
  "faroe islands": "fo",
  finland: "fi",
  france: "fr",
  georgia: "ge",
  germany: "de",
  greece: "gr",
  hungary: "hu",
  iceland: "is",
  ireland: "ie",
  "republic of ireland": "ie",
  israel: "il",
  italy: "it",
  kazakhstan: "kz",
  kosovo: "xk",
  latvia: "lv",
  liechtenstein: "li",
  lithuania: "lt",
  luxembourg: "lu",
  malta: "mt",
  moldova: "md",
  montenegro: "me",
  netherlands: "nl",
  "north macedonia": "mk",
  macedonia: "mk",
  "northern ireland": "gb-nir",
  norway: "no",
  poland: "pl",
  portugal: "pt",
  romania: "ro",
  russia: "ru",
  "san marino": "sm",
  scotland: "gb-sct",
  serbia: "rs",
  slovakia: "sk",
  slovenia: "si",
  spain: "es",
  sweden: "se",
  switzerland: "ch",
  turkey: "tr",
  turkiye: "tr",
  ukraine: "ua",
  wales: "gb-wls",

  // ── CONMEBOL ──
  argentina: "ar",
  bolivia: "bo",
  brazil: "br",
  chile: "cl",
  colombia: "co",
  ecuador: "ec",
  paraguay: "py",
  peru: "pe",
  uruguay: "uy",
  venezuela: "ve",

  // ── CONCACAF ──
  canada: "ca",
  "costa rica": "cr",
  cuba: "cu",
  curacao: "cw",
  "dominican republic": "do",
  "el salvador": "sv",
  guatemala: "gt",
  haiti: "ht",
  honduras: "hn",
  jamaica: "jm",
  mexico: "mx",
  panama: "pa",
  "trinidad and tobago": "tt",
  "united states": "us",
  usa: "us",
  "united states of america": "us",

  // ── CAF ──
  algeria: "dz",
  angola: "ao",
  benin: "bj",
  botswana: "bw",
  "burkina faso": "bf",
  cameroon: "cm",
  "cape verde": "cv",
  "cabo verde": "cv",
  "central african republic": "cf",
  chad: "td",
  comoros: "km",
  congo: "cg",
  "dr congo": "cd",
  "democratic republic of congo": "cd",
  "democratic republic of the congo": "cd",
  "cote d ivoire": "ci",
  "ivory coast": "ci",
  egypt: "eg",
  "equatorial guinea": "gq",
  eritrea: "er",
  eswatini: "sz",
  swaziland: "sz",
  ethiopia: "et",
  gabon: "ga",
  gambia: "gm",
  "the gambia": "gm",
  ghana: "gh",
  guinea: "gn",
  "guinea bissau": "gw",
  kenya: "ke",
  lesotho: "ls",
  liberia: "lr",
  libya: "ly",
  madagascar: "mg",
  malawi: "mw",
  mali: "ml",
  mauritania: "mr",
  mauritius: "mu",
  morocco: "ma",
  mozambique: "mz",
  namibia: "na",
  niger: "ne",
  nigeria: "ng",
  rwanda: "rw",
  senegal: "sn",
  "sierra leone": "sl",
  somalia: "so",
  "south africa": "za",
  "south sudan": "ss",
  sudan: "sd",
  tanzania: "tz",
  togo: "tg",
  tunisia: "tn",
  uganda: "ug",
  zambia: "zm",
  zimbabwe: "zw",

  // ── AFC ──
  afghanistan: "af",
  australia: "au",
  bahrain: "bh",
  bangladesh: "bd",
  bhutan: "bt",
  brunei: "bn",
  cambodia: "kh",
  china: "cn",
  "china pr": "cn",
  "hong kong": "hk",
  india: "in",
  indonesia: "id",
  iran: "ir",
  iraq: "iq",
  japan: "jp",
  jordan: "jo",
  kuwait: "kw",
  kyrgyzstan: "kg",
  laos: "la",
  lebanon: "lb",
  malaysia: "my",
  maldives: "mv",
  mongolia: "mn",
  myanmar: "mm",
  nepal: "np",
  "north korea": "kp",
  "korea dpr": "kp",
  oman: "om",
  pakistan: "pk",
  palestine: "ps",
  philippines: "ph",
  qatar: "qa",
  "saudi arabia": "sa",
  singapore: "sg",
  "south korea": "kr",
  "korea republic": "kr",
  korea: "kr",
  "sri lanka": "lk",
  syria: "sy",
  taiwan: "tw",
  "chinese taipei": "tw",
  tajikistan: "tj",
  thailand: "th",
  "timor leste": "tl",
  turkmenistan: "tm",
  "united arab emirates": "ae",
  uae: "ae",
  uzbekistan: "uz",
  vietnam: "vn",
  yemen: "ye",

  // ── OFC ──
  fiji: "fj",
  "new zealand": "nz",
  "new caledonia": "nc",
  "papua new guinea": "pg",
  "solomon islands": "sb",
  tahiti: "pf",
  vanuatu: "vu",
};

/** Distinct ISO codes referenced by the map — used by the flag-download
 *  tooling to fetch exactly the SVGs we bundle into `/public/flags/`. */
export const FLAG_CODES = Array.from(new Set(Object.values(COUNTRY_CODES)));

/** ISO code for a national team, or null for non-countries (clubs, etc.). */
export function countryFlagCode(name: string): string | null {
  if (!name) return null;
  return COUNTRY_CODES[normalize(name)] ?? null;
}

/** Same-origin path for a national team's flag, or null. Lossless WebP
 *  rendered at 160px (crisp at avatar sizes); bundled under `/public/flags`
 *  and served directly (the image loader skips `/`-prefixed assets). */
export function countryFlagSrc(name: string): string | null {
  const code = countryFlagCode(name);
  return code ? `/flags/${code}.webp` : null;
}
