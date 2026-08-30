import { CONTEXT_DOCUMENT_SCHEMA_VERSION } from "./content/context-documents";
import { CONTEXT_MODEL_MANIFEST } from "./model-manifest";

export interface ContextCalibrationArtifact {
  schemaVersion: 1;
  artifactVersion: string;
  fittedAt: string;
  fittedSplit: "validation";
  manifestVersion: string;
  documentSchemaVersion: string;
  rerankerRevision: string;
  thresholds: {
    directMatch: number;
    adjacent: number;
    rerankRecovery: number;
  };
}

export const BUNDLED_CONTEXT_CALIBRATION: ContextCalibrationArtifact | null =
  null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateContextCalibrationArtifact(value: unknown): {
  valid: boolean;
  issues: string[];
} {
  if (!isRecord(value)) {
    return { valid: false, issues: ["artifact_missing"] };
  }

  const issues: string[] = [];
  if (value.schemaVersion !== 1) issues.push("schema_version_mismatch");
  if (value.fittedSplit !== "validation") {
    issues.push("held_out_split_cannot_fit_calibration");
  }
  if (value.manifestVersion !== CONTEXT_MODEL_MANIFEST.manifestVersion) {
    issues.push("model_manifest_mismatch");
  }
  if (value.documentSchemaVersion !== CONTEXT_DOCUMENT_SCHEMA_VERSION) {
    issues.push("document_schema_mismatch");
  }
  if (value.rerankerRevision !== CONTEXT_MODEL_MANIFEST.reranker.revision) {
    issues.push("reranker_revision_mismatch");
  }

  const thresholds = isRecord(value.thresholds) ? value.thresholds : null;
  const directMatch = thresholds?.directMatch;
  const adjacent = thresholds?.adjacent;
  const rerankRecovery = thresholds?.rerankRecovery;
  if (
    typeof directMatch !== "number" ||
    !Number.isFinite(directMatch) ||
    typeof adjacent !== "number" ||
    !Number.isFinite(adjacent) ||
    directMatch <= adjacent ||
    adjacent < 0 ||
    typeof rerankRecovery !== "number" ||
    !Number.isFinite(rerankRecovery)
  ) {
    issues.push("invalid_thresholds");
  }
  if (
    typeof value.artifactVersion !== "string" ||
    value.artifactVersion.length === 0 ||
    typeof value.fittedAt !== "string" ||
    Number.isNaN(Date.parse(value.fittedAt))
  ) {
    issues.push("invalid_metadata");
  }

  return { valid: issues.length === 0, issues };
}

export function hasActiveContextCalibration(
  artifact: unknown = BUNDLED_CONTEXT_CALIBRATION
): artifact is ContextCalibrationArtifact {
  return validateContextCalibrationArtifact(artifact).valid;
}

export function classifyContextCandidate(
  score: number,
  artifact: ContextCalibrationArtifact | null = BUNDLED_CONTEXT_CALIBRATION
): {
  classification: "adjacent" | "direct_match" | "no_match" | null;
  reason: "calibrated" | "conservative_fallback";
} {
  if (artifact === null || !hasActiveContextCalibration(artifact)) {
    return { classification: null, reason: "conservative_fallback" };
  }

  if (score >= artifact.thresholds.directMatch) {
    return { classification: "direct_match", reason: "calibrated" };
  }
  if (score >= artifact.thresholds.adjacent) {
    return { classification: "adjacent", reason: "calibrated" };
  }
  return { classification: "no_match", reason: "calibrated" };
}
