import { CONTEXT_MODEL_MANIFEST } from "./model-manifest";

export type PromotionStatus = "failed" | "insufficient_evidence" | "passed";

export interface ContextPromotionRecord {
  schemaVersion: 1;
  evaluatedAt: string | null;
  manifestVersion: string;
  rerankerRevision: string;
  productionReranker: {
    status: PromotionStatus;
  };
}

export const BUNDLED_CONTEXT_PROMOTION: ContextPromotionRecord = {
  schemaVersion: 1,
  evaluatedAt: null,
  manifestVersion: CONTEXT_MODEL_MANIFEST.manifestVersion,
  rerankerRevision: CONTEXT_MODEL_MANIFEST.reranker.revision,
  productionReranker: { status: "insufficient_evidence" },
};

export function canUseProductionReranker(
  record: ContextPromotionRecord = BUNDLED_CONTEXT_PROMOTION
): boolean {
  return (
    record.schemaVersion === 1 &&
    record.productionReranker.status === "passed" &&
    record.manifestVersion === CONTEXT_MODEL_MANIFEST.manifestVersion &&
    record.rerankerRevision === CONTEXT_MODEL_MANIFEST.reranker.revision
  );
}
