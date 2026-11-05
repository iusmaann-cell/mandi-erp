// Auto-generated document number helpers. Format: PREFIX-YYMMDD-HHMMSS — encodes
// date and time down to the second (not just the minute) so two documents created
// close together don't collide. Every field this touches stays a normal editable
// text input — this only supplies the pre-filled suggestion.

export function generateDocNumber(prefix) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${prefix}-${yy}${mm}${dd}-${hh}${min}${ss}`;
}

// For entities that just want a simple sequential number (e.g. customer codes),
// not a date-based one. Looks at existing values sharing the prefix and picks the
// next number after the highest one found, zero-padded to 4 digits.
export function generateSequentialNumber(prefix, existingNumbers) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const n of existingNumbers) {
    if (!n) continue;
    const match = re.exec(n);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
