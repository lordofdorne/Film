import type { ReactNode } from "react";
import { Sequence, useRemotionEnvironment, useVideoConfig } from "remotion";

/**
 * How far ahead the preview gets each piece of media ready.
 *
 * Without it a clip is created at the frame it is first seen: a fresh element,
 * a new connection, a seek into the file — all while the film is meant to be
 * playing, which is the stutter at every cut. Two seconds is enough to fetch
 * and seek a 720p preview copy with a keyframe a second, on a phone.
 */
export const PREMOUNT_SECONDS = 2;

/**
 * A `<Sequence>` that, in the Player, mounts its media `PREMOUNT_SECONDS`
 * early, hidden and paused on its first frame, so it is ready at the cut.
 *
 * Remotion only premounts a sequence with a layout, and never while
 * rendering. So in the Player this uses the default layout, and in a render it
 * is exactly the `layout="none"` sequence it always was — the delivered film
 * is drawn by the same tree as before, frame for frame.
 */
export const MediaSequence = ({
  from,
  durationInFrames,
  name,
  children,
}: {
  readonly from: number;
  readonly durationInFrames: number;
  readonly name: string;
  readonly children: ReactNode;
}) => {
  const env = useRemotionEnvironment();
  const { fps } = useVideoConfig();
  if (!env.isPlayer) {
    return (
      <Sequence from={from} durationInFrames={durationInFrames} layout="none" name={name}>
        {children}
      </Sequence>
    );
  }
  return (
    <Sequence from={from} durationInFrames={durationInFrames} name={name} premountFor={PREMOUNT_SECONDS * fps}>
      {children}
    </Sequence>
  );
};
