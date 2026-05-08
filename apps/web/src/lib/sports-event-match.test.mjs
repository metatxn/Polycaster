import assert from "node:assert/strict";
import test from "node:test";
import { matchSportsEventToGame } from "./sports-event-match.ts";

test("matches a team event to a live sports websocket update by teams and kickoff date", () => {
  const game = {
    gameId: 20023784,
    leagueAbbreviation: "nba",
    slug: "nba-okc-lal-2026-05-08",
    homeTeam: "OKC",
    awayTeam: "LAL",
    status: "InProgress",
    score: "74-84",
    period: "Q3",
    elapsed: "02:52",
    live: true,
    ended: false,
    updatedAt: "2026-05-08T03:29:25.468477122Z",
    receivedAt: Date.now(),
  };

  const match = matchSportsEventToGame(
    {
      id: "440791",
      slug: "nba-lal-okc-2026-05-07",
      title: "Lakers vs. Thunder",
      startTime: "2026-05-08 01:30:00+00",
      teams: [
        { name: "Lakers", abbreviation: "LAL" },
        { name: "Thunder", abbreviation: "OKC" },
      ],
    },
    new Map([[String(game.gameId), game]])
  );

  assert.equal(match?.score, "74-84");
  assert.equal(match?.period, "Q3");
});

test("does not match a websocket update from another event date", () => {
  const match = matchSportsEventToGame(
    {
      id: "440791",
      slug: "nba-lal-okc-2026-05-07",
      title: "Lakers vs. Thunder",
      startTime: "2026-05-08 01:30:00+00",
      teams: [
        { name: "Lakers", abbreviation: "LAL" },
        { name: "Thunder", abbreviation: "OKC" },
      ],
    },
    new Map([
      [
        "20023784",
        {
          gameId: 20023784,
          leagueAbbreviation: "nba",
          slug: "nba-okc-lal-2026-05-11",
          homeTeam: "OKC",
          awayTeam: "LAL",
          status: "Scheduled",
          score: "",
          period: "",
          live: false,
          ended: false,
          receivedAt: Date.now(),
        },
      ],
    ])
  );

  assert.equal(match, null);
});
