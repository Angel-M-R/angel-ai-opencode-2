const ELLIPSIS = "…";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function graphemes(value: string): string[] { return Array.from(segmenter.segment(value), part => part.segment); }
function graphemeWidth(value: string): number {
  // OpenCode runs on Bun; use its Unicode width tables instead of a partial
  // local copy. Segmentation above keeps clipping on grapheme boundaries.
  return Bun.stringWidth(value);
}

export function textColumns(value: string): number {
  let columns = 0;
  for (const character of graphemes(value)) columns += graphemeWidth(character);
  return columns;
}

export function takeColumns(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";

  let columns = 0;
  let result = "";
  for (const character of graphemes(value)) {
    const width = graphemeWidth(character);
    if (columns + width > maxColumns) break;
    columns += width;
    result += character;
  }
  return result;
}

export function truncateToColumns(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return "";
  if (textColumns(value) <= maxColumns) return value;
  if (maxColumns <= textColumns(ELLIPSIS)) return ELLIPSIS;

  const prefix = takeColumns(
    value,
    maxColumns - textColumns(ELLIPSIS),
  ).trimEnd();
  return `${prefix}${ELLIPSIS}`;
}
