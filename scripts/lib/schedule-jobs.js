/**
 * Reading the job list out of scripts/scaffold-schedule.md. Shared by
 * scripts/scaffold-schedule.js, which runs the jobs, and scripts/edit-md.js,
 * which must not write back a schedule file that no longer parses.
 */

const JSON_BLOCK = /```json\r?\n([\s\S]*?)\r?\n```/g;

/** Hand-edited JSON picks up two mistakes constantly: real line breaks pasted
 * into a string value (e.g. multi-line `content`), which is a raw control
 * character JSON doesn't allow there, and a trailing comma before a closing
 * `}`/`]`, which JS object literals tolerate but JSON doesn't. Fixes both in
 * one string-boundary-aware pass — commas are only ever dropped outside a
 * string, and already-escaped sequences are left alone — so people don't
 * have to think about either when editing this file by hand. */
export function sanitizeHandEditedJson(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        // dropped: a preceding \r in a \r\n pair collapses into the \n escape above
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '}' && text[j] !== ']') out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/** The doc has other ```json fences too (a one-job example for a move job),
 * so the real job list is identified as the one fenced block whose content
 * is actually an array, not just "the first ```json fence". */
export function findJobsBlock(text) {
  for (const match of text.matchAll(JSON_BLOCK)) {
    if (match[1].trim().startsWith('[')) return match;
  }
  return null;
}

/** The parsed job array. Throws with the reason when it can't be read. */
export function parseJobs(text) {
  const match = findJobsBlock(text);
  if (!match) throw new Error('no ```json job list (a fenced JSON array)');
  const jobs = JSON.parse(sanitizeHandEditedJson(match[1]));
  if (!Array.isArray(jobs)) throw new Error("the job list isn't a JSON array");
  return jobs;
}
