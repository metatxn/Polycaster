export const EMBEDDING_FLOOR = 0.5;
export const FAIL_OPEN_FLOOR = 0.5;

export function describeRelevanceThreshold(
  configuredThreshold: number,
  aiCandidateValidationEnabled: boolean
): string {
  const configured = configuredThreshold.toFixed(2);

  if (
    configuredThreshold >= EMBEDDING_FLOOR &&
    configuredThreshold >= FAIL_OPEN_FLOOR
  ) {
    return `Configured threshold: ${configured}. All scoring paths require at least ${configured}.`;
  }

  if (!aiCandidateValidationEnabled) {
    return `Configured threshold: ${configured}. AI candidate validation is off, so the validator fallback rejects scores below ${Math.max(configuredThreshold, FAIL_OPEN_FLOOR).toFixed(2)}.`;
  }

  const hybridFloor = Math.max(configuredThreshold, EMBEDDING_FLOOR).toFixed(2);
  const validatorFloor = Math.max(configuredThreshold, FAIL_OPEN_FLOOR).toFixed(
    2
  );

  if (hybridFloor === validatorFloor) {
    return `Configured threshold: ${configured}. Hybrid matching and the validator fallback require ${hybridFloor}. Lexical or heuristic matches approved by AI candidate validation can use ${configured}.`;
  }

  return `Configured threshold: ${configured}. Hybrid matching requires ${hybridFloor}, and the validator fallback requires ${validatorFloor}. Lexical or heuristic matches approved by AI candidate validation can use ${configured}.`;
}
