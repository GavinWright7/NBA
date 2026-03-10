"use strict";

/** Parse integers — strips commas, returns null for blanks */
function parseIntClean(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, "");
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

/** Parse floats — strips commas, returns null for blanks */
function parseFloatClean(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

/** Parse percentage strings — strips % and commas */
function parsePercent(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/%/g, "").replace(/,/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

/** Parse K/M/B shorthand counts (e.g. "1.2M", "500K") → integer */
function parseCountKmb(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, "").replace(/\s/g, "");
  if (!t || t === "---" || /^[-–—]+$/.test(t)) return null;
  const m = t.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suffix = (m[2] || "").toUpperCase();
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  return Math.round(n);
}

module.exports = { parseIntClean, parseFloatClean, parsePercent, parseCountKmb };
