const AGENT_RUN_INTENT_PREFIX = "knoww_agent_run_intent:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AgentRunIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AgentRunIntentLockManager {
  request<Result>(
    name: string,
    callback: () => Result | Promise<Result>
  ): Promise<Result>;
}

function storageKey(intent: string): string {
  return `${AGENT_RUN_INTENT_PREFIX}${encodeURIComponent(intent)}`;
}

export function getOrCreateAgentRunIntentKey(
  storage: AgentRunIntentStorage,
  intent: string,
  randomUuid: () => string = () => crypto.randomUUID(),
  tabStorage: AgentRunIntentStorage = storage
): string {
  const key = storageKey(intent);
  const tabExisting = tabStorage.getItem(key);
  if (tabExisting && UUID_PATTERN.test(tabExisting)) return tabExisting;
  const existing = storage.getItem(key);
  if (existing && UUID_PATTERN.test(existing)) {
    tabStorage.setItem(key, existing);
    return existing;
  }

  const idempotencyKey = randomUuid();
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new Error("Could not create a valid run idempotency key");
  }
  storage.setItem(key, idempotencyKey);
  tabStorage.setItem(key, idempotencyKey);
  return idempotencyKey;
}

export function getOrCreateAgentRunIntentKeyWithLock(
  storage: AgentRunIntentStorage,
  intent: string,
  lockManager: AgentRunIntentLockManager,
  randomUuid: () => string = () => crypto.randomUUID(),
  tabStorage: AgentRunIntentStorage = storage
): Promise<string> {
  return lockManager.request(`knoww-agent-run:${intent}`, () =>
    getOrCreateAgentRunIntentKey(storage, intent, randomUuid, tabStorage)
  );
}

export function completeAgentRunIntent(
  storage: AgentRunIntentStorage,
  intent: string,
  idempotencyKey: string,
  tabStorage: AgentRunIntentStorage = storage
): void {
  const key = storageKey(intent);
  if (tabStorage.getItem(key) === idempotencyKey) tabStorage.removeItem(key);
  if (storage.getItem(key) === idempotencyKey) storage.removeItem(key);
}
