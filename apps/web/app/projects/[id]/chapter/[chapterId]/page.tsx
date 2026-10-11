import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { guardProject } from "../../../../../src/server/auth.js";
import { loadWalkthroughView } from "../../../../../src/server/capture.js";
import {
  backHref,
  beginHref,
  chaptersOf,
  durationOf,
  isDone,
  outlineOf,
  progressOf,
  skipChapterHref,
} from "../../../../../src/server/wizard.js";
import { Button, Chip, Icon } from "../../../../../src/ui/index.js";
import { WizardFrame } from "../../WizardFrame.js";

/**
 * A chapter's front door: what is coming, how long it takes, and what to set
 * up first.
 *
 * It exists because the chapters really are different kinds of time. The
 * interview needs two people and one sitting; the photographs can be found on
 * a sofa a week later. Saying so before the first question — rather than
 * discovering it mid-way with somebody's grandmother waiting — is the whole
 * job. Every word on it comes from the template.
 */
export default async function ChapterPage({
  params,
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;
  const guard = await guardProject(id, `/projects/${id}/chapter/${chapterId}`);
  if (guard.needsAccount) redirect(`/projects/${id}`);

  const view = await loadWalkthroughView(id);
  if (view === null) notFound();
  if (view.status !== "capturing") redirect(`/projects/${id}`);

  const chapters = chaptersOf(view.steps);
  const chapter = chapters.find((c) => c.id === chapterId);
  if (chapter === undefined) notFound();

  const first = chapter.steps[0];
  const remaining = chapter.steps.filter((step) => !isDone(step)).length;
  const started = remaining < chapter.steps.length;

  return (
    <WizardFrame
      projectId={id}
      backHref={first === undefined ? `/projects/${id}` : backHref(id, view.steps, first.id)}
      where={`Part ${String(chapter.number)} of ${String(chapters.length)}`}
      progress={progressOf(view.steps, chapter.id)}
      outline={outlineOf(id, view.steps)}
    >
      <main className="wz-body">
        <p className="eyebrow wz-intro__part">
          Part {chapter.number} of {chapters.length}
        </p>
        <h1 className="wz-intro__title">{chapter.title}</h1>
        <p className="lede">{chapter.blurb}</p>

        <div className="wz-intro__meta">
          <Chip>
            <Icon name="list" size={14} />
            {chapter.steps.length === 1 ? "1 step" : `${String(chapter.steps.length)} steps`}
          </Chip>
          <Chip>
            <Icon name="clock" size={14} />
            {durationOf(chapter.steps)}
          </Chip>
          {started && <Chip tone="success">{remaining === 0 ? "All done" : `${String(remaining)} left`}</Chip>}
        </div>

        {chapter.prepare.length > 0 && (
          <section className="stack-4">
            <h2 className="heading">Before you start</h2>
            <ul className="list wz-prepare">
              {chapter.prepare.map((line) => (
                <li key={line}>
                  <span className="wz-prepare__tick" aria-hidden>
                    <Icon name="check" size={16} strokeWidth={2.4} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="wz-foot">
        <div className="wz-foot__row">
          <Button variant="quiet" asChild>
            <Link href={skipChapterHref(id, view.steps, chapter.id)}>Not now</Link>
          </Button>
          <Button size="lg" asChild>
            <Link href={beginHref(id, view.steps, chapter.id)}>
              {started ? "Carry on" : "Begin"}
              <Icon name="forward" size={18} />
            </Link>
          </Button>
        </div>
      </footer>
    </WizardFrame>
  );
}
