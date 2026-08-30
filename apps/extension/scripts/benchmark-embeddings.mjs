#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  pipeline,
} from "@huggingface/transformers";
import { BROWSER_MODEL_CANDIDATES } from "./lib/browser-model-comparison.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATASETS = [
  path.resolve(__dirname, "../perf-fixtures/embedding-ab.json"),
  path.resolve(__dirname, "../perf-fixtures/embedding-ab-extra.jsonl"),
];
const DEFAULT_DATASET_ARG = DEFAULT_DATASETS.join(",");
const DEFAULT_CACHE_DIR = path.resolve(
  __dirname,
  "../.embedding-benchmark-cache"
);

const EMBEDDING_CONFIGS = [
  {
    type: "embedding",
    id: "bge-small-mean",
    label: "BGE small mean baseline",
    model: "onnx-community/bge-small-en-v1.5-ONNX",
    revision: "4a9a46c7b88fa408e650a571a1800243f26309bd",
    dtype: "q4",
    pooling: "mean",
    queryPrefix:
      "Represent this sentence for searching relevant prediction markets: ",
  },
  {
    type: "embedding",
    id: "bge-small-current-cls",
    label: "BGE small current cls",
    model: "onnx-community/bge-small-en-v1.5-ONNX",
    revision: "4a9a46c7b88fa408e650a571a1800243f26309bd",
    dtype: "q4",
    pooling: "cls",
    queryPrefix:
      "Represent this sentence for searching relevant prediction markets: ",
  },
  {
    type: "embedding",
    id: "bge-small-cls-q8",
    label: "BGE small cls q8",
    model: "onnx-community/bge-small-en-v1.5-ONNX",
    revision: "4a9a46c7b88fa408e650a571a1800243f26309bd",
    dtype: "q8",
    pooling: "cls",
    queryPrefix:
      "Represent this sentence for searching relevant prediction markets: ",
  },
  {
    type: "embedding",
    id: "snowflake-arctic-s-cls",
    label: "Snowflake Arctic S cls",
    model: "Snowflake/snowflake-arctic-embed-s",
    revision: "e596f507467533e48a2e17c007f0e1dacc837b33",
    dtype: "q4",
    pooling: "cls",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
  },
  {
    type: "embedding",
    id: "snowflake-arctic-s-cls-q8",
    label: "Snowflake Arctic S cls q8",
    model: "Snowflake/snowflake-arctic-embed-s",
    revision: "e596f507467533e48a2e17c007f0e1dacc837b33",
    dtype: "q8",
    pooling: "cls",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
  },
  {
    type: "embedding",
    id: "snowflake-arctic-s-market-cls",
    label: "Snowflake Arctic S market cls",
    model: "Snowflake/snowflake-arctic-embed-s",
    revision: "e596f507467533e48a2e17c007f0e1dacc837b33",
    dtype: "q4",
    pooling: "cls",
    queryPrefix:
      "Represent this sentence for searching relevant prediction markets: ",
  },
  {
    type: "embedding",
    id: "snowflake-arctic-m-v1.5-cls-int8",
    label: "Snowflake Arctic M v1.5 cls int8",
    model: "Snowflake/snowflake-arctic-embed-m-v1.5",
    revision: "e58a8f756156a1293d763f17e3aae643474e9b8a",
    dtype: "int8",
    pooling: "cls",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
  },
];

const RERANK_CONFIGS = [
  {
    type: "rerank",
    id: "bge-mean-xencoder-top5-int8",
    label: "BGE mean + MiniLM cross-encoder top5 int8",
    firstStageConfigId: "bge-small-mean",
    model: "Xenova/ms-marco-MiniLM-L-6-v2",
    revision: "a09144355adeed5f58c8ed011d209bf8ee5a1fec",
    dtype: "q8",
    rerankCandidates: 5,
  },
  {
    type: "rerank",
    id: "snowflake-q8-xencoder-top5-int8",
    label: "Snowflake q8 + MiniLM cross-encoder top5 int8",
    firstStageConfigId: "snowflake-arctic-s-cls-q8",
    model: "Xenova/ms-marco-MiniLM-L-6-v2",
    revision: "a09144355adeed5f58c8ed011d209bf8ee5a1fec",
    dtype: "q8",
    rerankCandidates: 5,
  },
  {
    type: "rerank",
    id: "snowflake-q8-jina-tiny-top5-int8",
    label: "Snowflake q8 + Jina tiny cross-encoder top5 int8",
    firstStageConfigId: "snowflake-arctic-s-cls-q8",
    model: "jinaai/jina-reranker-v1-tiny-en",
    revision: "aca45de6945b5dc6399abcd2a9c55ded5dc9111f",
    dtype: "int8",
    rerankCandidates: 5,
  },
  {
    type: "rerank",
    id: "snowflake-q8-mixedbread-xsmall-top5-q8",
    label: "Snowflake q8 + Mixedbread xsmall cross-encoder top5 q8",
    firstStageConfigId: "snowflake-arctic-s-cls-q8",
    model: "mixedbread-ai/mxbai-rerank-xsmall-v1",
    revision: "b5c6e9da73abc3711f593f705371cdbe9e0fe422",
    dtype: "q8",
    rerankCandidates: 5,
  },
];

const CONFIGS = [...EMBEDDING_CONFIGS, ...RERANK_CONFIGS];

function write(message = "") {
  process.stdout.write(`${message}\n`);
}

function writeError(message = "") {
  process.stderr.write(`${message}\n`);
}

function parseArgs(argv) {
  const args = {
    datasets: DEFAULT_DATASETS,
    configs: CONFIGS.map((config) => config.id),
    cacheDir: DEFAULT_CACHE_DIR,
    batchSize: 8,
    topK: 3,
    maxCases: Number.POSITIVE_INFINITY,
    json: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === "--dataset") {
      args.datasets = next()
        .split(",")
        .map((value) => path.resolve(value));
    } else if (arg === "--configs") args.configs = next().split(",");
    else if (arg === "--cache-dir") args.cacheDir = path.resolve(next());
    else if (arg === "--batch-size") args.batchSize = Number(next());
    else if (arg === "--top-k") args.topK = Number(next());
    else if (arg === "--max-cases") args.maxCases = Number(next());
    else if (arg === "--json") args.json = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--help" || arg === "-h") {
      writeHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.batchSize) || args.batchSize < 1) {
    throw new Error("--batch-size must be a positive integer");
  }
  if (!Number.isInteger(args.topK) || args.topK < 1) {
    throw new Error("--top-k must be a positive integer");
  }
  if (
    !Number.isFinite(args.maxCases) &&
    args.maxCases !== Number.POSITIVE_INFINITY
  ) {
    throw new Error("--max-cases must be a positive integer");
  }
  if (
    Number.isFinite(args.maxCases) &&
    (!Number.isInteger(args.maxCases) || args.maxCases < 1)
  ) {
    throw new Error("--max-cases must be a positive integer");
  }

  return args;
}

function writeHelp() {
  write(`Usage: pnpm --filter @knoww/extension benchmark:embeddings [options]

Options:
  --dataset <paths>      Labeled JSON/JSONL path(s), comma-separated.
                         Default: ${DEFAULT_DATASET_ARG}
  --configs <ids>        Comma-separated config ids. Default: all configs
  --cache-dir <path>     Transformers.js cache directory. Default: ${DEFAULT_CACHE_DIR}
  --batch-size <n>       Texts per inference batch. Default: 8
  --top-k <n>            Report Recall@K and nDCG@K. Default: 3
  --max-cases <n>        Limit cases for smoke testing.
  --json                 Print machine-readable JSON.
  --quiet                Suppress per-config progress.

Available configs:
${CONFIGS.map((config) => `  ${config.id} (${config.label})`).join("\n")}`);
}

async function loadDatasetFile(datasetPath) {
  const raw = await readFile(datasetPath, "utf8");
  if (datasetPath.endsWith(".jsonl")) {
    return {
      version: 1,
      description: `JSONL cases from ${datasetPath}`,
      cases: raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line);
          } catch (error) {
            throw new Error(
              `Invalid JSONL at ${datasetPath}:${index + 1}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }),
    };
  }

  const dataset = JSON.parse(raw);
  return dataset;
}

async function loadDataset(datasetPaths, maxCases) {
  const datasets = await Promise.all(datasetPaths.map(loadDatasetFile));
  const dataset = {
    version: 1,
    description: `Merged ${datasets.length} embedding benchmark fixture(s)`,
    cases: datasets.flatMap((entry) => entry.cases ?? []),
  };

  if (!Array.isArray(dataset.cases)) {
    throw new Error("Dataset must contain a cases array");
  }

  const cases = dataset.cases.slice(0, maxCases);
  const seenIds = new Set();
  for (const testCase of cases) {
    if (!testCase.id || typeof testCase.postText !== "string") {
      throw new Error("Every case needs id and postText");
    }
    if (seenIds.has(testCase.id)) {
      throw new Error(`Duplicate case id: ${testCase.id}`);
    }
    seenIds.add(testCase.id);
    if (!Array.isArray(testCase.markets) || testCase.markets.length === 0) {
      throw new Error(`Case ${testCase.id} needs at least one market`);
    }
  }

  return { ...dataset, cases };
}

function selectedConfigs(configIds) {
  return configIds.map((id) => {
    const config = CONFIGS.find((candidate) => candidate.id === id);
    if (!config) {
      throw new Error(
        `Unknown config "${id}". Run with --help to list valid config ids.`
      );
    }
    return config;
  });
}

function toTextSet(dataset, config) {
  const values = new Set();
  for (const testCase of dataset.cases) {
    values.add(`${config.queryPrefix}${testCase.postText}`);
    for (const market of testCase.markets) values.add(market.text);
  }
  return [...values];
}

function embeddingConfigById(id) {
  const config = EMBEDDING_CONFIGS.find((candidate) => candidate.id === id);
  if (!config) throw new Error(`Unknown first-stage config: ${id}`);
  return config;
}

function disposeTensors(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.dispose === "function") {
    value.dispose();
    return;
  }
  for (const item of Object.values(value)) disposeTensors(item);
}

async function embedTexts(texts, config, batchSize) {
  const extractor = await pipeline("feature-extraction", config.model, {
    dtype: config.dtype,
    revision: config.revision,
  });

  try {
    const vectors = new Map();
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const output = await extractor(batch, {
        pooling: config.pooling,
        normalize: true,
      });

      try {
        const data = output.data;
        const dim = output.dims[1];
        for (let j = 0; j < batch.length; j++) {
          vectors.set(
            batch[j],
            Float32Array.from(data.slice(j * dim, (j + 1) * dim))
          );
        }
      } finally {
        output.dispose();
      }
    }
    return vectors;
  } finally {
    await extractor.dispose();
  }
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function dcg(relevances) {
  return relevances.reduce((sum, relevance, index) => {
    return sum + (2 ** relevance - 1) / Math.log2(index + 2);
  }, 0);
}

function rankCaseByEmbeddings(testCase, config, vectors) {
  const query = `${config.queryPrefix}${testCase.postText}`;
  const queryVector = vectors.get(query);
  if (!queryVector) throw new Error(`Missing query vector for ${testCase.id}`);

  return testCase.markets
    .map((market) => {
      const vector = vectors.get(market.text);
      if (!vector) throw new Error(`Missing market vector: ${market.id}`);
      return {
        id: market.id,
        text: market.text,
        relevance: Number(market.relevance) || 0,
        score: dot(queryVector, vector),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function evaluateRankedCase(testCase, ranked, topK) {
  const firstRelevantIndex = ranked.findIndex((market) => market.relevance > 0);
  const top = ranked.slice(0, topK);
  const ideal = [...testCase.markets]
    .map((market) => Number(market.relevance) || 0)
    .sort((a, b) => b - a)
    .slice(0, topK);
  const ndcgDenominator = dcg(ideal);

  return {
    id: testCase.id,
    reciprocalRank:
      firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    recallAt1: ranked[0]?.relevance > 0 ? 1 : 0,
    recallAtK: top.some((market) => market.relevance > 0) ? 1 : 0,
    ndcgAtK:
      ndcgDenominator === 0
        ? 0
        : dcg(top.map((market) => market.relevance)) / ndcgDenominator,
    firstRelevantRank:
      firstRelevantIndex === -1 ? null : firstRelevantIndex + 1,
    top: top.map((market) => ({
      id: market.id,
      relevance: market.relevance,
      score: Number(market.score.toFixed(6)),
    })),
  };
}

function evaluateCase(testCase, config, vectors, topK) {
  return evaluateRankedCase(
    testCase,
    rankCaseByEmbeddings(testCase, config, vectors),
    topK
  );
}

async function scorePairs(pairs, config, batchSize) {
  const tokenizer = await AutoTokenizer.from_pretrained(config.model, {
    revision: config.revision,
  });
  const model = await AutoModelForSequenceClassification.from_pretrained(
    config.model,
    { dtype: config.dtype, revision: config.revision }
  );

  try {
    const scores = [];
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      const inputs = tokenizer(
        batch.map((pair) => pair.query),
        {
          text_pair: batch.map((pair) => pair.document),
          padding: true,
          truncation: true,
        }
      );

      try {
        const output = await model(inputs);
        const logits = output.logits;
        const width = logits.dims.at(-1) ?? 1;
        for (let j = 0; j < batch.length; j++) {
          const offset = j * width;
          const score =
            width === 1 ? logits.data[offset] : logits.data[offset + 1];
          scores.push(Number(score));
        }
        disposeTensors(output);
      } finally {
        disposeTensors(inputs);
      }
    }
    return scores;
  } finally {
    await model.dispose();
  }
}

async function evaluateRerankConfig(dataset, config, batchSize, topK) {
  const firstStageConfig = embeddingConfigById(config.firstStageConfigId);
  const vectors = await embedTexts(
    toTextSet(dataset, firstStageConfig),
    firstStageConfig,
    batchSize
  );

  const pendingPairs = [];
  const firstStageRankings = new Map();
  for (const testCase of dataset.cases) {
    const ranked = rankCaseByEmbeddings(testCase, firstStageConfig, vectors);
    firstStageRankings.set(testCase.id, ranked);
    for (const market of ranked.slice(0, config.rerankCandidates)) {
      pendingPairs.push({
        caseId: testCase.id,
        marketId: market.id,
        query: testCase.postText,
        document: market.text,
      });
    }
  }

  const scores = await scorePairs(pendingPairs, config, batchSize);
  const pairScores = new Map(
    pendingPairs.map((pair, index) => [
      `${pair.caseId}\u0000${pair.marketId}`,
      scores[index],
    ])
  );

  return dataset.cases.map((testCase) => {
    const ranked = firstStageRankings.get(testCase.id);
    const reranked = ranked
      .slice(0, config.rerankCandidates)
      .map((market) => ({
        ...market,
        score:
          pairScores.get(`${testCase.id}\u0000${market.id}`) ?? market.score,
      }))
      .sort((a, b) => b.score - a.score)
      .concat(ranked.slice(config.rerankCandidates));
    return evaluateRankedCase(testCase, reranked, topK);
  });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(config, caseResults, elapsedMs, topK) {
  const ranks = caseResults
    .map((result) => result.firstRelevantRank)
    .filter((rank) => rank !== null);

  const artifact = BROWSER_MODEL_CANDIDATES.find(
    (candidate) => candidate.model === config.model
  )?.artifact;
  return {
    type: config.type,
    id: config.id,
    label: config.label,
    model: config.model,
    revision: config.revision,
    dtype: config.dtype,
    pooling: config.pooling,
    firstStageConfigId: config.firstStageConfigId,
    rerankCandidates: config.rerankCandidates,
    mrr: mean(caseResults.map((result) => result.reciprocalRank)),
    recallAt1: mean(caseResults.map((result) => result.recallAt1)),
    [`recallAt${topK}`]: mean(caseResults.map((result) => result.recallAtK)),
    [`ndcgAt${topK}`]: mean(caseResults.map((result) => result.ndcgAtK)),
    meanFirstRelevantRank: mean(ranks),
    elapsedMs,
    quality: {
      mrr: mean(caseResults.map((result) => result.reciprocalRank)),
      recallAt1: mean(caseResults.map((result) => result.recallAt1)),
      [`recallAt${topK}`]: mean(caseResults.map((result) => result.recallAtK)),
      [`ndcgAt${topK}`]: mean(caseResults.map((result) => result.ndcgAtK)),
    },
    latency: { totalEvaluationMs: elapsedMs },
    resources: { modelArtifactBytes: artifact?.bytes ?? null },
    reliability: { completedCases: caseResults.length, failures: 0 },
    cache: { cacheDirectoryConfigured: true },
    cases: caseResults,
  };
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printSummary(results, topK) {
  const metricKeys = ["mrr", "recallAt1", `recallAt${topK}`, `ndcgAt${topK}`];
  const sorted = [...results].sort(
    (a, b) => b[`ndcgAt${topK}`] - a[`ndcgAt${topK}`]
  );

  write("");
  write("Embedding and rerank A/B results");
  write(
    [
      "config".padEnd(34),
      "MRR".padStart(8),
      "R@1".padStart(8),
      `R@${topK}`.padStart(8),
      `nDCG@${topK}`.padStart(10),
      "mean rank".padStart(11),
      "time".padStart(9),
    ].join("  ")
  );
  for (const result of sorted) {
    write(
      [
        result.id.padEnd(34),
        result.mrr.toFixed(3).padStart(8),
        formatPct(result.recallAt1).padStart(8),
        formatPct(result[`recallAt${topK}`]).padStart(8),
        result[`ndcgAt${topK}`].toFixed(3).padStart(10),
        result.meanFirstRelevantRank.toFixed(2).padStart(11),
        `${Math.round(result.elapsedMs)}ms`.padStart(9),
      ].join("  ")
    );
  }

  const winner = sorted[0];
  write("");
  write(`Winner by nDCG@${topK}: ${winner.id}`);
  write("");
  write("Per-case top predictions for winner:");
  for (const testCase of winner.cases) {
    const top = testCase.top
      .map((market) => `${market.id}:${market.relevance}:${market.score}`)
      .join(", ");
    write(`  ${testCase.id}: ${top}`);
  }

  write("");
  write(
    `Metric order: ${metricKeys.join(", ")}. Prefer nDCG@${topK} when labels are graded; prefer MRR/R@1 when only one market should be shown.`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = await loadDataset(args.datasets, args.maxCases);
  const configs = selectedConfigs(args.configs);

  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useFSCache = true;
  env.cacheDir = args.cacheDir;

  const results = [];
  for (const config of configs) {
    if (!args.quiet) {
      const detail =
        config.type === "rerank"
          ? `${config.model}, ${config.dtype}, first-stage ${config.firstStageConfigId}, top${config.rerankCandidates}`
          : `${config.model}, ${config.dtype}, ${config.pooling}`;
      write(`Running ${config.id} (${detail})`);
    }
    const start = Date.now();
    let caseResults;
    if (config.type === "rerank") {
      caseResults = await evaluateRerankConfig(
        dataset,
        config,
        args.batchSize,
        args.topK
      );
    } else {
      const vectors = await embedTexts(
        toTextSet(dataset, config),
        config,
        args.batchSize
      );
      caseResults = dataset.cases.map((testCase) =>
        evaluateCase(testCase, config, vectors, args.topK)
      );
    }
    results.push(summarize(config, caseResults, Date.now() - start, args.topK));
  }

  if (args.json) {
    write(
      JSON.stringify(
        { datasets: args.datasets, topK: args.topK, results },
        null,
        2
      )
    );
  } else {
    printSummary(results, args.topK);
  }
}

main().catch((error) => {
  writeError(
    error instanceof Error ? error.stack || error.message : String(error)
  );
  process.exitCode = 1;
});
