"use strict";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(level, msg) {
  if ((LEVELS[level] ?? 1) < MIN_LEVEL) return;
  const prefix =
    level === "error" ? "❌" :
    level === "warn"  ? "⚠️ " :
    level === "info"  ? "ℹ️ " : "🔍";
  const line = `[${ts()}] ${prefix} ${msg}`;
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function section(title) {
  const bar = "─".repeat(60);
  console.log(`\n${bar}\n  ${title}\n${bar}`);
}

module.exports = { log, section };
