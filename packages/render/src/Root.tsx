import { Composition } from "remotion";
import sampleEdl from "../../../sample/life-advice.edl.json" with { type: "json" };
import sampleManifest from "../../../sample/life-advice.manifest.json" with { type: "json" };
import sampleSubject from "../../../sample/life-advice.subject.json" with { type: "json" };
import { FilmComposition } from "./FilmComposition.js";
import { buildFilmProps } from "./fixture.js";
import type { FilmProps } from "./props.js";
import { msToFrame } from "./timing/windows.js";

/**
 * The fixture film. Props are built — and the EDL validated — at module load,
 * so a malformed document fails the bundle rather than rendering 6420 frames
 * of something wrong.
 */
const fixtureProps: FilmProps = buildFilmProps({
  edl: sampleEdl,
  manifest: sampleManifest,
  subject: sampleSubject,
});

export const RemotionRoot = () => (
  <Composition
    id="LifeAdvice"
    component={FilmComposition}
    defaultProps={fixtureProps}
    /**
     * Dimensions and length come from whichever EDL is actually passed, not
     * from the fixture. Without this the composition would be locked to the
     * fixture's 6420 frames and a real project would be cut off — or padded
     * with black — at exactly the wrong place.
     */
    calculateMetadata={({ props }) => ({
      width: props.format.width,
      height: props.format.height,
      fps: props.format.fps,
      durationInFrames: msToFrame(props.edl.totalDurationMs, props.format.fps),
    })}
    // Static fallbacks, used only until calculateMetadata has run.
    width={fixtureProps.format.width}
    height={fixtureProps.format.height}
    fps={fixtureProps.format.fps}
    durationInFrames={msToFrame(fixtureProps.edl.totalDurationMs, fixtureProps.format.fps)}
  />
);
