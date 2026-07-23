import "./index.css";
import "./fonts";
import { Composition } from "remotion";
import { KnowwOnboarding } from "./KnowwOnboarding";

const FPS = 30;
const DURATION = 2700; // 90s

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="KnowwOnboarding"
        component={KnowwOnboarding}
        durationInFrames={DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="KnowwOnboardingVertical"
        component={KnowwOnboarding}
        durationInFrames={DURATION}
        fps={FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="KnowwOnboardingSquare"
        component={KnowwOnboarding}
        durationInFrames={DURATION}
        fps={FPS}
        width={1080}
        height={1080}
      />
    </>
  );
};
