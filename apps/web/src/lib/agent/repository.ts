import {
  type AgentD1Database,
  type AgentRepository,
  createAgentRepository,
} from "@knoww/agent/repository";
import { createLogger } from "@knoww/logger";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const log = createLogger("agent.repository");

interface AgentDbEnv {
  AGENT_DB?: D1Database;
}

let warnedMemoryFallback = false;

export async function getAgentRepository(): Promise<AgentRepository> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const db = (env as AgentDbEnv).AGENT_DB;
    if (db) return createAgentRepository(db as AgentD1Database);
  } catch (error) {
    if (!warnedMemoryFallback) {
      log.error("d1.context.unavailable", { error });
      warnedMemoryFallback = true;
    }
  }
  return createAgentRepository();
}
