/** Class names, skipping the falsy ones. */
export const cx = (...names: readonly (string | false | null | undefined)[]): string =>
  names.filter((name) => typeof name === "string" && name !== "").join(" ");
