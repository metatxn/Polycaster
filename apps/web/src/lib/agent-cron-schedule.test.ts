import { describe, expect, it } from "vitest";
import {
  AGENT_CRON_EXPRESSION,
  shouldRunAgentCron,
} from "./agent-cron-schedule";

describe("shouldRunAgentCron", () => {
  it("requires both the dedicated agent schedule and explicit enablement", () => {
    expect(shouldRunAgentCron(AGENT_CRON_EXPRESSION, "true")).toBe(true);
    expect(shouldRunAgentCron("0 * * * *", "true")).toBe(false);
    expect(shouldRunAgentCron(AGENT_CRON_EXPRESSION, "false")).toBe(false);
  });
});
