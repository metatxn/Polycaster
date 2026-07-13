function normalizedWarMatch(pattern) {
  if (typeof pattern !== "string") return null;
  const match = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]+)(?:\/.*)?$/);
  if (!match) return null;
  return `${match[1]}://${match[2]}/*`;
}

function ownersOf(entries, resource) {
  return entries.flatMap((entry, index) =>
    Array.isArray(entry?.resources) && entry.resources.includes(resource)
      ? [{ entry, index }]
      : []
  );
}

export function validateLazyWarContract(
  webAccessibleResources,
  supportedMatchPatterns
) {
  const failures = [];
  if (!Array.isArray(webAccessibleResources)) {
    return ["web_accessible_resources must be an array"];
  }
  if (!Array.isArray(supportedMatchPatterns)) {
    return ["supported match patterns must be an array"];
  }

  const platformOwners = ownersOf(webAccessibleResources, "platforms/*.js");
  const tradingOwners = ownersOf(webAccessibleResources, "content-trading.js");
  if (platformOwners.length !== 1) {
    failures.push(
      `expected exactly one platforms/*.js WAR owner, got ${platformOwners.length}`
    );
  }
  if (tradingOwners.length !== 1) {
    failures.push(
      `expected exactly one content-trading.js WAR owner, got ${tradingOwners.length}`
    );
  }
  if (
    platformOwners.length === 1 &&
    tradingOwners.length === 1 &&
    platformOwners[0].index !== tradingOwners[0].index
  ) {
    failures.push(
      "content-trading.js must use the same canonical WAR owner as platforms/*.js"
    );
  }

  const canonical =
    platformOwners.length === 1 ? platformOwners[0].entry : null;
  if (!canonical) return failures;
  for (const resource of ["platforms/*.js", "content-trading.js"]) {
    const count = canonical.resources.filter(
      (value) => value === resource
    ).length;
    if (count !== 1) {
      failures.push(
        `canonical WAR resources must contain ${resource} exactly once`
      );
    }
  }

  const expectedMatches = [];
  for (const pattern of supportedMatchPatterns) {
    const normalized = normalizedWarMatch(pattern);
    if (!normalized) {
      failures.push(
        `unsupported canonical match pattern ${JSON.stringify(pattern)}`
      );
      continue;
    }
    if (!expectedMatches.includes(normalized)) expectedMatches.push(normalized);
  }
  if (!Array.isArray(canonical.matches)) {
    failures.push("canonical lazy WAR owner matches must be an array");
    return failures;
  }
  const actualMatches = canonical.matches;
  if (new Set(actualMatches).size !== actualMatches.length) {
    failures.push("canonical lazy WAR owner contains duplicate matches");
  }
  for (const expected of expectedMatches) {
    if (!actualMatches.includes(expected)) {
      failures.push(`canonical lazy WAR owner is missing match ${expected}`);
    }
  }
  for (const actual of actualMatches) {
    if (!expectedMatches.includes(actual)) {
      failures.push(
        `canonical lazy WAR owner has unexpected match ${String(actual)}`
      );
    }
  }
  return failures;
}
