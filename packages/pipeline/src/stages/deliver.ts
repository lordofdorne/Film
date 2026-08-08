import { eq } from "drizzle-orm";
import { hashInputs, projects, renders, type StageIdentity } from "@film/db";

import { permanent } from "../runtime/errors.js";
import type { StageContext } from "../runtime/runStage.js";

export const deliverIdentity = (input: {
  readonly projectId: string;
  readonly renderId: string;
}): StageIdentity => ({
  projectId: input.projectId,
  assetId: null,
  stage: "deliver",
  inputHash: hashInputs({ renderId: input.renderId }),
});

/**
 * Hand the finished film over.
 *
 * Today that means marking the project delivered against a specific render, so
 * the download surface has one unambiguous file to offer and the pipeline has
 * a terminal state to stop at. It does NOT email anyone: there is no mail
 * provider configured and no template written, and a stage that pretended to
 * send would be worse than one that plainly does not.
 *
 * When mail arrives it belongs here, and it must stay idempotent — the stage
 * can be re-run, and a customer receiving the same film twice is a bug. The
 * exactly-once claim on (project, stage, input hash) is what makes that safe,
 * which is why the input hash is the render id and nothing else.
 */
export const runDeliver = async (ctx: StageContext, renderId: string): Promise<string | null> => {
  const rows = await ctx.db.select().from(renders).where(eq(renders.id, renderId)).limit(1);
  const render = rows[0];
  if (render === undefined) throw permanent(`render ${renderId} no longer exists`);

  if (render.status !== "succeeded" || render.outputKey === null) {
    throw permanent(`render ${renderId} produced no output to deliver`);
  }

  // Confirms the object is really there before telling anyone it is. An
  // upload that half-failed leaves a row pointing at nothing, and the first
  // person to find out should not be the customer.
  const head = await ctx.store.head(render.outputKey);
  if (head === null) throw permanent(`the rendered film is missing from storage`);

  await ctx.db
    .update(projects)
    .set({ status: "delivered", updatedAt: new Date() })
    .where(eq(projects.id, ctx.projectId));

  await ctx.log.info(
    `delivered ${render.outputKey} (${(head.byteSize / 1e6).toFixed(1)} MB) — ` +
      "no mail provider is configured, so nothing was sent",
  );

  return render.outputKey;
};
