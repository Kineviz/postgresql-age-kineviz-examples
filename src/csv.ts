/** RFC 4180 records, including quoted newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += c;
  }
  if (quoted) throw new Error("Unterminated CSV field");
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
export function csvCell(value: unknown): string {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export function csvRows(rows: unknown[][]): string { return rows.map(row => row.map(csvCell).join(",")).join("\n") + "\n"; }
