import type { Db } from "@film/db";
import { stageEvents } from "@film/db";

export type LogLevel = "info" | "warn" | "error";

/**
 * Where a stage says what it is doing.
 *
 * Two destinations on purpose. stdout is for whoever is watching a container
 * right now; stage_events is for the question that actually gets asked in
 * production — "what happened to this one project, three days ago". Container
 * logs are rotated and aggregated per host, and reconstructing one project's
 * history out of them is miserable. The rows are keyed to the execution, so
 * the history is a single indexed query.
 */
export interface StageLog {
  info(message: string, data?: Record<string, unknown>): Promise<void>;
  warn(message: string, data?: Record<string, unknown>): Promise<void>;
  error(message: string, data?: Record<string, unknown>): Promise<void>;
}

const write = (prefix: string, level: LogLevel, message: string): void => {
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${new Date().toISOString()} ${level.padEnd(5)} ${prefix} ${message}\n`);
};

export const createStageLog = (
  db: Db,
  executionId: string,
  prefix: string,
): StageLog => {
  const record = async (
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> => {
    write(prefix, level, message);
    try {
      await db.insert(stageEvents).values({
        stageExecutionId: executionId,
        level,
        message: message.slice(0, 2000),
        ...(data === undefined ? {} : { data }),
      });
    } catch (error: unknown) {
      // Losing a log line must never fail the work it was describing.
      write(prefix, "warn", `could not record stage event: ${String(error)}`);
    }
  };

  return {
    info: async (m, d) => record("info", m, d),
    warn: async (m, d) => record("warn", m, d),
    error: async (m, d) => record("error", m, d),
  };
};

/** For code paths that run before a stage is claimed, or outside one entirely. */
export const consoleLog = (prefix: string): StageLog => ({
  info: async (m) => { write(prefix, "info", m); },
  warn: async (m) => { write(prefix, "warn", m); },
  error: async (m) => { write(prefix, "error", m); },
});
