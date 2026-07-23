import { Audio, Sequence, staticFile } from "remotion";

/**
 * Audio bed per spec §6 — minimal score (sustained drone + sparse motif that
 * resolves at the end card, baked into score.wav) and exactly three SFX:
 * (1) a soft tick when odds update, (2) a low click on Confirm Order,
 * (3) a paper-like whoosh on masthead rules. Nothing else.
 */

// Absolute beat frames (30fps). Scene starts: 01→0, 03→450, 05→930, 10→2280.
const WHOOSH_FRAMES = [4, 2284]; // masthead rules draw in (scenes 01, 10)
const TICK_FRAMES = [570, 940]; // odds tick 68¢→69¢ (scenes 03, 05)
const CLICK_FRAMES = [976, 1130]; // YES click + Confirm Order (scene 05)

const SFX_DURATION = 60; // generous tail; clips are all < 2s

export const Soundtrack: React.FC = () => {
  return (
    <>
      <Audio src={staticFile("score.wav")} volume={0.5} name="Score" />
      {WHOOSH_FRAMES.map((from) => (
        <Sequence
          key={`whoosh-${from}`}
          from={from}
          durationInFrames={SFX_DURATION}
          name="SFX: whoosh"
        >
          <Audio src={staticFile("sfx/whoosh.wav")} volume={0.3} />
        </Sequence>
      ))}
      {TICK_FRAMES.map((from) => (
        <Sequence
          key={`tick-${from}`}
          from={from}
          durationInFrames={SFX_DURATION}
          name="SFX: odds tick"
        >
          <Audio src={staticFile("sfx/switch.wav")} volume={0.25} />
        </Sequence>
      ))}
      {CLICK_FRAMES.map((from) => (
        <Sequence
          key={`click-${from}`}
          from={from}
          durationInFrames={SFX_DURATION}
          name="SFX: click"
        >
          <Audio src={staticFile("sfx/mouse-click.wav")} volume={0.4} />
        </Sequence>
      ))}
    </>
  );
};
