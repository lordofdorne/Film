import type { CSSProperties } from "react";
import { OffthreadVideo, Video, useVideoConfig } from "remotion";

/**
 * The only place in this package that renders a video element.
 *
 * Every frame of interview audio comes from the speech track, and b-roll
 * carries no audio at all. This component therefore hardcodes silence and
 * exposes no way to undo it: there is no volume prop, no muted prop, and no
 * spread of arbitrary props onto the underlying element. A caller cannot
 * unmute picture even by trying.
 *
 * Combined with the schema — InterviewSegment and BrollSegment have no audio
 * field, and both are strict — this is the second of the layers that make
 * audio doubling unrepresentable rather than merely unlikely. A boundary test
 * asserts that video elements appear only here and audio elements appear only
 * in the three explicit track modules.
 *
 * OffthreadVideo is used for server renders because it extracts frames with
 * FFmpeg rather than seeking a <video> element, which is both faster and
 * frame-exact. It does not exist in the Player, so preview falls back to
 * <Video muted>; picture is identical either way.
 */
export type PictureOnlyVideoProps = {
  readonly src: string;
  readonly trimBefore: number;
  readonly trimAfter: number;
  readonly style: CSSProperties;
};

export const PictureOnlyVideo = ({
  src,
  trimBefore,
  trimAfter,
  style,
}: PictureOnlyVideoProps) => {
  // useVideoConfig throws outside a composition, which is the right failure:
  // it means someone rendered picture without a timeline to hang it on.
  useVideoConfig();

  const isServerRender =
    typeof window !== "undefined" &&
    (window as { remotion_isPlayer?: boolean }).remotion_isPlayer !== true;

  if (isServerRender) {
    return (
      <OffthreadVideo
        src={src}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        muted
        style={style}
      />
    );
  }

  return (
    <Video
      src={src}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      muted
      volume={0}
      style={style}
    />
  );
};
