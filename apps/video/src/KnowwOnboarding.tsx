import { AbsoluteFill, Sequence } from "remotion";
import { Folio } from "./components/Folio";
import { Soundtrack } from "./Soundtrack";
import { SCENE_01_DURATION, Scene01Masthead } from "./scenes/Scene01Masthead";
import { SCENE_02_DURATION, Scene02Problem } from "./scenes/Scene02Problem";
import { SCENE_03_DURATION, Scene03Reveal } from "./scenes/Scene03Reveal";
import {
  SCENE_04_DURATION,
  Scene04HowItWorks,
} from "./scenes/Scene04HowItWorks";
import { SCENE_05_DURATION, Scene05Trade } from "./scenes/Scene05Trade";
import {
  SCENE_06_DURATION,
  Scene06Everywhere,
} from "./scenes/Scene06Everywhere";
import { SCENE_07_DURATION, Scene07WebApp } from "./scenes/Scene07WebApp";
import { SCENE_08_DURATION, Scene08Funding } from "./scenes/Scene08Funding";
import { SCENE_09_DURATION, Scene09Agent } from "./scenes/Scene09Agent";
import { SCENE_10_DURATION, Scene10Close } from "./scenes/Scene10Close";
import { theme } from "./theme";

/**
 * Knoww onboarding — 90s / 2,700 frames at 30fps. Each scene is a hard-cut
 * <Sequence>; timings come straight from the production spec (§4). The scene
 * graph is shared across the 16:9, 9:16 and 1:1 compositions.
 */
const SCENES = [
  { C: Scene01Masthead, d: SCENE_01_DURATION, name: "01 · Masthead", page: 1 },
  { C: Scene02Problem, d: SCENE_02_DURATION, name: "02 · Problem", page: 2 },
  { C: Scene03Reveal, d: SCENE_03_DURATION, name: "03 · Reveal", page: 3 },
  {
    C: Scene04HowItWorks,
    d: SCENE_04_DURATION,
    name: "04 · How it works",
    page: 4,
  },
  { C: Scene05Trade, d: SCENE_05_DURATION, name: "05 · Trade", page: 5 },
  {
    C: Scene06Everywhere,
    d: SCENE_06_DURATION,
    name: "06 · Everywhere",
    page: 6,
  },
  { C: Scene07WebApp, d: SCENE_07_DURATION, name: "07 · Web app", page: 7 },
  { C: Scene08Funding, d: SCENE_08_DURATION, name: "08 · Funding", page: 8 },
  { C: Scene09Agent, d: SCENE_09_DURATION, name: "09 · Agent layer", page: 9 },
  { C: Scene10Close, d: SCENE_10_DURATION, name: "10 · Close", page: 10 },
] as const;

export const KnowwOnboarding: React.FC = () => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Soundtrack />
      {SCENES.map(({ C, d, name, page }) => {
        const from = cursor;
        cursor += d;
        // Interior pages carry the running head + folio; the two masthead
        // scenes (01, 10) bring their own furniture.
        const interior = page !== 1 && page !== 10;
        return (
          <Sequence key={name} name={name} from={from} durationInFrames={d}>
            <C />
            {interior ? <Folio page={page} /> : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
