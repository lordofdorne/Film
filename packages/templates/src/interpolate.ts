import type { Format } from "@film/formats";
import type { Question, QuestionText, Template } from "./types.js";

export type SubjectData = {
  readonly subjectName: string;
  readonly displayName: string;
  readonly age: number;
  readonly relationshipLabel?: string;
  readonly interviewerName?: string;
  readonly interviewerRelationship?: string;
};

export type TextResult =
  | { readonly ok: true; readonly text: string; readonly usedFallback: boolean }
  | { readonly ok: false; readonly reason: "unresolved" | "too-long"; readonly detail: string };

const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Substitute {{tokens}}. A missing or empty token is reported, never rendered:
 * "I interviewed my 94 year old undefined" must be impossible to produce.
 */
export const interpolate = (
  pattern: string,
  vars: Readonly<Record<string, string | number | undefined>>,
): { ok: true; text: string } | { ok: false; missing: string[] } => {
  const missing: string[] = [];
  const text = pattern.replace(TOKEN, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined || value === "") {
      missing.push(name);
      return "";
    }
    return String(value);
  });
  return missing.length > 0 ? { ok: false, missing } : { ok: true, text };
};

export const subjectVars = (
  subject: SubjectData,
  template: Template,
): Readonly<Record<string, string | number | undefined>> => ({
  subjectName: subject.subjectName,
  displayName: subject.displayName,
  age: subject.age,
  relationshipLabel: subject.relationshipLabel,
  interviewerName: subject.interviewerName,
  interviewerRelationship: subject.interviewerRelationship,
  titleNoun: template.text.titleNoun,
});

/**
 * Resolve one of the template's text keys for a subject.
 *
 * Falls back to `text.fallbacks[key]` when the primary pattern has an
 * unresolvable token — which is how "I interviewed my 94 year old grandmother"
 * degrades to "I interviewed Nana, who is 94 years old" when no relationship
 * label was supplied.
 *
 * Length is checked against the format and FAILS rather than truncating or
 * shrinking the type. A title that does not fit is a content problem to solve
 * upstream, not a layout problem to paper over at render time.
 */
export const resolveText = (
  template: Template,
  key: string,
  subject: SubjectData,
  format: Format,
): TextResult => {
  const pattern = template.text.keys[key];
  if (pattern === undefined) {
    return { ok: false, reason: "unresolved", detail: `no text key "${key}" in ${template.id}` };
  }
  const vars = subjectVars(subject, template);

  let resolved = interpolate(pattern, vars);
  let usedFallback = false;

  if (!resolved.ok) {
    const fallback = template.text.fallbacks[key];
    if (fallback === undefined) {
      return {
        ok: false,
        reason: "unresolved",
        detail: `"${key}" needs ${resolved.missing.join(", ")} and has no fallback`,
      };
    }
    const viaFallback = interpolate(fallback, vars);
    if (!viaFallback.ok) {
      return {
        ok: false,
        reason: "unresolved",
        detail: `"${key}" fallback also needs ${viaFallback.missing.join(", ")}`,
      };
    }
    resolved = viaFallback;
    usedFallback = true;
  }

  if (resolved.text.length > format.titleMaxChars) {
    return {
      ok: false,
      reason: "too-long",
      detail:
        `"${key}" resolves to ${resolved.text.length} characters, over the ` +
        `${format.titleMaxChars} that fit in ${format.id}: "${resolved.text}"`,
    };
  }

  return { ok: true, text: resolved.text, usedFallback };
};

/** Resolve every text key a template declares, or explain why not. */
export const resolveAllText = (
  template: Template,
  subject: SubjectData,
  format: Format,
): { ok: true; text: Record<string, string> } | { ok: false; failures: string[] } => {
  const out: Record<string, string> = {};
  const failures: string[] = [];
  for (const key of Object.keys(template.text.keys)) {
    const r = resolveText(template, key, subject, format);
    if (r.ok) out[key] = r.text;
    else failures.push(`${r.reason}: ${r.detail}`);
  }
  return failures.length > 0 ? { ok: false, failures } : { ok: true, text: out };
};

/* ── conditional question wording ─────────────────────────────────────── */

/**
 * The only condition grammar: `subject.<field> <op> <number>`.
 *
 * Deliberately not an expression language and deliberately not eval. Template
 * data is authored, reviewed configuration, but it is still data, and data
 * that can execute is a category of bug this project does not need. Anything
 * more expressive than this should be a new field, not a longer string.
 */
const CONDITION = /^subject\.([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|>|<|===|!==)\s*(-?\d+(?:\.\d+)?)$/;

export const evaluateCondition = (
  expression: string,
  subject: SubjectData,
): boolean => {
  const match = CONDITION.exec(expression.trim());
  if (match === null) {
    throw new Error(
      `unsupported condition "${expression}"; only "subject.<field> <op> <number>" is allowed`,
    );
  }
  const [, field, op, literal] = match;
  if (field === undefined || op === undefined || literal === undefined) {
    throw new Error(`unsupported condition "${expression}"`);
  }
  const actual = (subject as unknown as Record<string, unknown>)[field];
  if (typeof actual !== "number") return false;
  const expected = Number(literal);

  switch (op) {
    case ">=": return actual >= expected;
    case "<=": return actual <= expected;
    case ">": return actual > expected;
    case "<": return actual < expected;
    case "===": return actual === expected;
    case "!==": return actual !== expected;
    default: throw new Error(`unreachable operator "${op}"`);
  }
};

/** The wording a given subject is actually asked, with tokens substituted. */
export const resolveQuestionText = (
  question: Question,
  subject: SubjectData,
  template: Template,
): TextResult => {
  const spec: QuestionText = question.text;
  let pattern: string;

  if (typeof spec === "string") {
    pattern = spec;
  } else {
    const hit = spec.variants.find((v) => evaluateCondition(v.when, subject));
    pattern = hit?.text ?? spec.default;
  }

  const resolved = interpolate(pattern, subjectVars(subject, template));
  return resolved.ok
    ? { ok: true, text: resolved.text, usedFallback: false }
    : {
        ok: false,
        reason: "unresolved",
        detail: `question "${question.id}" needs ${resolved.missing.join(", ")}`,
      };
};
