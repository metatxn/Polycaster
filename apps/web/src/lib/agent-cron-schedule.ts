// Keep the agent on a distinct cadence from other scheduled worker jobs.
// Deploy this trigger only when automatic agent execution is intentionally on.
export const AGENT_CRON_EXPRESSION = "*/5 * * * *";

export function shouldRunAgentCron(
  cron: string,
  enabled: string | undefined
): boolean {
  return enabled === "true" && cron === AGENT_CRON_EXPRESSION;
}
