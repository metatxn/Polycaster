function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function midpoint(left, right) {
  return (left + right) / 2;
}

function boundaryCandidates(values, minimum) {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  const scale = Math.max(1, ...sorted.map((value) => Math.abs(value)));
  const epsilon = scale * 1e-9;
  const candidates = [sorted[0] - epsilon];
  for (let index = 1; index < sorted.length; index++) {
    candidates.push(midpoint(sorted[index - 1], sorted[index]));
  }
  candidates.push(sorted.at(-1) + epsilon);

  if (minimum !== undefined) candidates.push(minimum);
  return [...new Set(candidates)]
    .filter((value) => minimum === undefined || value >= minimum)
    .sort((left, right) => left - right);
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

function evaluateOrderedThresholds(rows, directMatch, adjacent) {
  const confusion = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const row of rows) {
    const predicted =
      row.score >= directMatch ? 2 : row.score >= adjacent ? 1 : 0;
    confusion[row.label][predicted]++;
  }

  const recalls = confusion.map((counts, label) => {
    const total = counts.reduce((sum, count) => sum + count, 0);
    return counts[label] / total;
  });
  const correct = confusion.reduce(
    (sum, counts, label) => sum + counts[label],
    0
  );
  return {
    balancedAccuracy:
      recalls.reduce((sum, recall) => sum + recall, 0) / recalls.length,
    accuracy: correct / rows.length,
    confusion,
  };
}

function isBetterOrderedFit(candidate, current) {
  if (!current) return true;
  if (candidate.balancedAccuracy !== current.balancedAccuracy) {
    return candidate.balancedAccuracy > current.balancedAccuracy;
  }
  if (candidate.accuracy !== current.accuracy) {
    return candidate.accuracy > current.accuracy;
  }
  if (candidate.directMatch !== current.directMatch) {
    return candidate.directMatch > current.directMatch;
  }
  return candidate.adjacent > current.adjacent;
}

function fitOrderedThresholds(rows) {
  const candidates = boundaryCandidates(
    rows.map((row) => row.score),
    0
  );
  let best = null;
  for (const adjacent of candidates) {
    for (const directMatch of candidates) {
      if (directMatch <= adjacent) continue;
      const metrics = evaluateOrderedThresholds(rows, directMatch, adjacent);
      const candidate = { directMatch, adjacent, ...metrics };
      if (isBetterOrderedFit(candidate, best)) best = candidate;
    }
  }
  if (!best) {
    fail("rows", "cannot produce ordered non-negative thresholds");
  }
  return best;
}

function evaluateBinaryThreshold(positive, negative, threshold) {
  const truePositive = positive.filter((score) => score >= threshold).length;
  const trueNegative = negative.filter((score) => score < threshold).length;
  return {
    balancedAccuracy:
      (truePositive / positive.length + trueNegative / negative.length) / 2,
    accuracy:
      (truePositive + trueNegative) / (positive.length + negative.length),
  };
}

function fitRerankThreshold(positive, negative) {
  const candidates = boundaryCandidates([...positive, ...negative]);
  let best = null;
  for (const threshold of candidates) {
    const metrics = evaluateBinaryThreshold(positive, negative, threshold);
    const candidate = { threshold, ...metrics };
    if (
      !best ||
      candidate.balancedAccuracy > best.balancedAccuracy ||
      (candidate.balancedAccuracy === best.balancedAccuracy &&
        (candidate.accuracy > best.accuracy ||
          (candidate.accuracy === best.accuracy &&
            candidate.threshold > best.threshold)))
    ) {
      best = candidate;
    }
  }
  return best;
}

export function fitContextCalibration(rows, metadata) {
  if (!Array.isArray(rows) || rows.length === 0) {
    fail("rows", "must contain validation examples");
  }
  rows.forEach((row, index) => {
    if (row?.split !== "validation") {
      fail(`rows[${index}].split`, "must be validation");
    }
    if (![0, 1, 2].includes(row.label)) {
      fail(`rows[${index}].label`, "must be 0, 1, or 2");
    }
    if (!Number.isFinite(row.score)) {
      fail(`rows[${index}].score`, "must be finite");
    }
  });

  const direct = rows.filter((row) => row.label === 2);
  const adjacent = rows.filter((row) => row.label === 1);
  const negative = rows.filter((row) => row.label === 0);
  if (direct.length === 0 || adjacent.length === 0 || negative.length === 0) {
    fail("rows", "must include direct, adjacent, and no-match labels");
  }

  const relevantRerankScores = rows
    .filter((row) => row.label > 0 && Number.isFinite(row.rerankScore))
    .map((row) => row.rerankScore);
  const negativeRerankScores = rows
    .filter((row) => row.label === 0 && Number.isFinite(row.rerankScore))
    .map((row) => row.rerankScore);
  if (relevantRerankScores.length === 0 || negativeRerankScores.length === 0) {
    fail("rows", "rerank calibration needs relevant and no-match scores");
  }

  const orderedFit = fitOrderedThresholds(rows);
  const rerankFit = fitRerankThreshold(
    relevantRerankScores,
    negativeRerankScores
  );

  for (const key of [
    "artifactVersion",
    "fittedAt",
    "manifestVersion",
    "documentSchemaVersion",
    "rerankerRevision",
  ]) {
    if (typeof metadata?.[key] !== "string" || metadata[key].length === 0) {
      fail(`metadata.${key}`, "must be a non-empty string");
    }
  }

  return {
    schemaVersion: 1,
    artifactVersion: metadata.artifactVersion,
    fittedAt: metadata.fittedAt,
    fittedSplit: "validation",
    manifestVersion: metadata.manifestVersion,
    documentSchemaVersion: metadata.documentSchemaVersion,
    rerankerRevision: metadata.rerankerRevision,
    thresholds: {
      directMatch: orderedFit.directMatch,
      adjacent: orderedFit.adjacent,
      rerankRecovery: rerankFit.threshold,
    },
    trainingSummary: {
      objective: "balanced_accuracy",
      rows: rows.length,
      direct: direct.length,
      adjacent: adjacent.length,
      noMatch: negative.length,
      balancedAccuracy: roundMetric(orderedFit.balancedAccuracy),
      accuracy: roundMetric(orderedFit.accuracy),
      confusionMatrix: orderedFit.confusion,
      rerankBalancedAccuracy: roundMetric(rerankFit.balancedAccuracy),
      rerankAccuracy: roundMetric(rerankFit.accuracy),
    },
  };
}
