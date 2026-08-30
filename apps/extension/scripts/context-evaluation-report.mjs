#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assessEvaluationReadiness,
  assessPromotionReadiness,
} from "./lib/context-evaluation.mjs";

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

async function main() {
  const datasetPath = readArgument("--dataset");
  if (!datasetPath) {
    throw new Error(
      "Usage: context-evaluation-report --dataset <path> [--assessment <path>]"
    );
  }

  const dataset = await readJson(datasetPath);
  const assessmentPath = readArgument("--assessment");
  const assessment = assessmentPath ? await readJson(assessmentPath) : {};
  const readiness = assessEvaluationReadiness(dataset);
  const promotions = assessPromotionReadiness(dataset, assessment);

  process.stdout.write(
    `${JSON.stringify({ readiness, promotions }, null, 2)}\n`
  );
  if (!readiness.ready) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
