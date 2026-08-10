const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a string can be a project id at all.
 *
 * Every id in this schema is a uuid column, and Postgres rejects a value that
 * cannot be cast to one by raising — which surfaces as a 500 from whatever
 * route passed it through. A URL somebody typed wrong is not a server fault,
 * and answering it with one both misreports the error and tells a stranger
 * that their input reached the database.
 *
 * Checked at the boundary rather than by giving every query a guard: the
 * callers that take an id from a URL are few and known.
 */
export const isProjectId = (value: string): boolean => UUID.test(value);
