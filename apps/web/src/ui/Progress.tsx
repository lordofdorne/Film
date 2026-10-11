import { cx } from "./cx.js";

/**
 * Progress drawn as the walk-through's chapters, each segment as wide as its
 * share of the steps and filled by how much of it is done. Somebody can see
 * at a glance both how far they are and that the photographs are a separate,
 * shorter thing still to come.
 */
export type ChapterSegment = {
  readonly id: string;
  readonly title: string;
  readonly total: number;
  readonly done: number;
  readonly current?: boolean;
};

export const ChapterProgress = ({
  chapters,
  label,
}: {
  readonly chapters: readonly ChapterSegment[];
  /** What a screen reader hears, e.g. "9 of 22 done". */
  readonly label: string;
}) => {
  const total = chapters.reduce((sum, c) => sum + c.total, 0);
  const done = chapters.reduce((sum, c) => sum + c.done, 0);
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={label}
    >
      {chapters.map((chapter) => (
        <span
          key={chapter.id}
          className={cx("ui-progress__seg", chapter.current === true && "ui-progress__seg--current")}
          style={{ flexGrow: chapter.total }}
        >
          <span
            className="ui-progress__fill"
            style={{ width: `${String(Math.round((chapter.done / Math.max(1, chapter.total)) * 100))}%` }}
          />
        </span>
      ))}
    </div>
  );
};
