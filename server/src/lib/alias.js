// Device models are "BRAND LINE MODEL [NETWORK] RAM+STORAGE [COLOR / EDITION
// QUALIFIER]" with no fixed word count per field (e.g. "A5 PRO 4G 256GB Brown" vs
// "Galaxy A07 LTE (4+128GB) Light Violet" vs "Xiaomi Redmi Note 14 5G 12GB 512GB
// Midnight Black") — so neither a fixed character count nor a fixed word count can
// draw the line between "same model and spec, different color/edition" and
// "different model that happens to share a brand/line name" (Redmi Note 12s vs 14,
// or a phone vs an unrelated Xiaomi drill). Instead: scan each model's words left to
// right for the first one that looks like a RAM/storage spec (256GB, 4+128GB,
// 12GB+256GB, (4+128GB), a typo like "64BB") — everything up to AND INCLUDING that
// token must match exactly (so "Note 12s" never merges with "Note 14", and a 128GB
// config never merges with a 64GB one), while anything AFTER it (color, "Light",
// "- Holiday Package", …) is free to vary and gets folded into the same alias. If no
// spec token exists at all, fall back to trimming a trailing run of known color
// words, so plain "... Black"/"... Blue" models can still merge without a GB token.
// A model with neither (e.g. an accessory with no spec/color at all) keeps its full
// name as its own one-item alias rather than guessing.
//
// Kept in sync by hand with client/src/pages/StockView.jsx's identical copy (Stock
// View's own Alias View groups client-side; CPFR groups server-side since its
// editable fields are now stored keyed by alias) — the same text in, same alias out
// in both places is the point, so change both together.
// "BB" is included alongside GB/MB/TB specifically for the observed typo "64BB" (for
// "64GB") — a bare "2+ digits then any 2 letters" pattern was tried first, but that
// also matched legitimate non-storage specs like a 40mm watch case ("40MM"), eating
// real words. Only known near-misses of "GB" belong here, not an open-ended pattern.
const GB_SUFFIX_RE = /^\(?\d+(\.\d+)?(GB|MB|TB|BB)\)?$/i;
const RAM_STORAGE_COMBO_RE = /^\(?\d+(GB|MB|TB|BB)?\+\d+(GB|MB|TB|BB)?\)?$/i;
function isSpecToken(tok) {
  return GB_SUFFIX_RE.test(tok) || RAM_STORAGE_COMBO_RE.test(tok);
}
const COLOR_WORDS = new Set([
  'BLACK', 'WHITE', 'BLUE', 'GREEN', 'GRAY', 'GREY', 'PURPLE', 'PINK', 'RED', 'GOLD', 'SILVER', 'ORANGE', 'YELLOW', 'BROWN',
  'TITANIUM', 'VIOLET', 'BRONZE', 'BEIGE', 'TEAL', 'NAVY', 'MAROON', 'LAVENDER', 'MINT', 'ROSE', 'GRAPHITE', 'MIDNIGHT',
  'SUNSET', 'OCEAN', 'FOREST', 'SKY', 'CORAL', 'PEARL', 'ONYX', 'ICE', 'IONIC', 'CERAMIC', 'IVORY', 'CHARCOAL', 'PLATINUM',
  'CHAMPAGNE', 'SAND', 'SANDY', 'CLOUD', 'CRYSTAL', 'GLACIER', 'STAR', 'STARRY', 'DREAMY', 'MIST', 'MISTY', 'CLOVER', 'PALM',
  'LIME', 'AURORA', 'OPAL', 'DEEP', 'ATLANTIC', 'JADE', 'RUBY', 'SAPPHIRE', 'EMERALD', 'AMBER', 'COBALT', 'SLATE', 'STEEL', 'CHROME',
  'LIGHT',
]);

function tokenize(s) {
  return (s || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
}

// Index right AFTER the shared, must-match portion of `tokens` — i.e. through and
// including the first RAM/storage spec token, if any, else through the last
// non-color token (trimming a trailing run of color words).
function variantCutIndex(tokens) {
  for (let i = 0; i < tokens.length; i++) if (isSpecToken(tokens[i])) return i + 1;
  let end = tokens.length;
  while (end > 0 && COLOR_WORDS.has(tokens[end - 1])) end--;
  return end;
}

export function aliasKey(deviceModel) {
  const tokens = tokenize(deviceModel);
  let cut = variantCutIndex(tokens);
  if (cut === 0) cut = tokens.length; // the very first token is itself a spec/color — keep the whole name
  return tokens.slice(0, cut).join(' ') || '(blank)';
}
