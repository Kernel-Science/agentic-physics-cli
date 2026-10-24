import { readFileSync } from "node:fs";

/** This package's version, read from its package.json (dist/src/version.js → ../../package.json). */
export const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();
