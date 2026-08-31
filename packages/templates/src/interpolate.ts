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

/**
 * A subject mid-capture: the same shape with nothing promised yet.
 *
 * Details are steps in the walk-through now, so a project exists before anyone
 * has said who it is about. Everything that words a capture step accepts this;
 * everything that words a film still demands the full SubjectData, because a
 * film with a hole in its title must stay impossible to produce.
 */
export type PartialSubject = Partial<SubjectData>;

/**
 * What a subject must have before a film can be composed. Lives beside
 * SubjectData so the two cannot drift apart quietly; validateTemplate uses it
 * to refuse a template whose walk-through could never fill the subject in.
 */
export const REQUIRED_SUBJECT_FIELDS = ["subjectName", "displayName", "age"] as const;

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
  subject: PartialSubject,
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

/**
 * The text key under which a question's own wording is resolved.
 *
 * A question card names the question and the template supplies the words —
 * which is the schema's rule for visual segments, verbatim: "It is a KEY,
 * never a literal — the template owns all copy." Without this the EDL would
 * have to carry the question text itself, and a film would be a place copy
 * lives.
 *
 * The namespace also keeps questions from colliding with `text.keys`: a
 * template is free to have a question called `closing` and a title key called
 * `closing`, and they are different strings.
 */
export const questionTextKey = (questionId: string): string => `question:${questionId}`;

/**
 * Resolve every text key a template declares, or explain why not.
 *
 * Question wording is included, under `question:<id>`, so the renderer can draw
 * a question card from a key. A question that does NOT resolve is left out
 * rather than failing the film: the bonus question needs an interviewer's name
 * that most films do not have, and a missing card is a smaller loss than no
 * film. Compose asks the same question separately and simply does not put a
 * card there — the two halves agree, so a key can never be missing at render.
 */
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
  for (const question of template.questions) {
    const r = resolveQuestionText(question, subject, template);
    if (r.ok) out[questionTextKey(question.id)] = r.text;
  }
  return failures.length > 0 ? { ok: false, failures } : { ok: true, text: out };
};

/**
 * The questions this film should put on a card, for this subject.
 *
 * Two filters, and both are needed. The template says which narrative roles
 * get a card at all — the introduction answers are already summarised by the
 * title, so asking "What is your name?" on screen would be answering a
 * question the film just answered. And the wording has to actually resolve for
 * this person, or the render would look up a key that `resolveAllText` left
 * out.
 */
export const questionCardIds = (
  template: Template,
  subject: SubjectData,
): string[] =>
  template.questions
    .filter((q) => !template.questionPrompt.omitCardForRoles.includes(q.narrativeRole))
    .filter((q) => resolveQuestionText(q, subject, template).ok)
    .map((q) => q.id);

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
  subject: PartialSubject,
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
  subject: PartialSubject,
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
