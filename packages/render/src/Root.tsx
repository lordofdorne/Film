import { Composition } from "remotion";
import sampleEdl from "../../../sample/life-advice.edl.json" with { type: "json" };
import sampleManifest from "../../../sample/life-advice.manifest.json" with { type: "json" };
import sampleSubject from "../../../sample/life-advice.subject.json" with { type: "json" };
import { FilmComposition } from "./FilmComposition.js";
import { buildFixtureProps } from "./fixture.js";
import type { FilmProps } from "./props.js";
import { msToFrame } from "./timing/windows.js";

/**
 * The fixture film. Props are built — and the EDL validated — at module load,
 * so a malformed document fails the bundle rather than rendering 6420 frames
 * of something wrong.
 */
const fixtureProps: FilmProps = buildFixtureProps({
  edl: sampleEdl,
  manifest: sampleManifest,
  subject: sampleSubject,
});

export const RemotionRoot = () => (
  <Composition
    id="LifeAdvice"
    component={FilmComposition}
    width={fixtureProps.format.width}
    height={fixtureProps.format.height}
    fps={fixtureProps.format.fps}
    durationInFrames={msToFrame(
      fixtureProps.edl.totalDurationMs,
      fixtureProps.format.fps,
    )}
    defaultProps={fixtureProps}
  />
);
