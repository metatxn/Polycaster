import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  type FeatureExtractionPipeline,
  LogLevel,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type ProgressInfo,
  pipeline,
} from "@huggingface/transformers";
import { logDebug, logInfo, logWarn } from "@knoww/logger";
import { getInferenceDevice, type InferenceDevice } from "./inference-device";
import { LRUCache } from "./lru-cache";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
env.logLevel = LogLevel.WARNING;

/**
 * Pre-load the bundled ONNX WASM binary so onnxruntime-web never hits
 * the Cache API with a chrome-extension:// URL (which throws).
 *
 * Called once, lazily, right before the first pipeline() call —
 * by that point all module-scope initialisers have run and
 * `env.backends.onnx.wasm` is the real onnxruntime-web env object.
 */
async function preloadOnnxWasm(): Promise<void> {
  const getRuntimeUrl = globalThis.chrome?.runtime?.getURL;
  if (typeof getRuntimeUrl !== "function") return;

  const onnxEnv = env.backends?.onnx;
  if (!onnxEnv?.wasm) return;

  const wasmUrl = getRuntimeUrl("ort/ort-wasm-simd-threaded.asyncify.wasm");
  const mjsUrl = getRuntimeUrl("ort/ort-wasm-simd-threaded.asyncify.mjs");

  onnxEnv.wasm.proxy = false;
  onnxEnv.wasm.numThreads =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? Math.max(Math.min(Math.floor(navigator.hardwareConcurrency / 2), 4), 1)
      : 2;

  try {
    const res = await fetch(wasmUrl);
    if (res.ok) {
      onnxEnv.wasm.wasmBinary = await res.arrayBuffer();
    }
  } catch (e) {
    logWarn("embeddings.wasm-preload-failed", {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  onnxEnv.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl };
}

const EMBEDDING_MODEL_ID = "Snowflake/snowflake-arctic-embed-s";
const EMBEDDING_DTYPE = "int8";
const RERANK_LOG_PREFIX = "[XENCODER-AB]";
const RERANK_MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";
const RERANK_DTYPE = "q8";
const RERANK_BATCH_SIZE = 8;

let pipelineInstance: Promise<FeatureExtractionPipeline> | null = null;
let warmUpPromise: Promise<void> | null = null;
let rerankerInstance: Promise<{
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
  device: InferenceDevice;
}> | null = null;
let rerankQueue: Promise<void> = Promise.resolve();

function buildPipelineOptions(): {
  dtype: typeof EMBEDDING_DTYPE;
  progress_callback: (progress: ProgressInfo) => void;
} {
  // Transformers.js fires progress events on every fetched chunk, which
  // produces hundreds of log lines per model download. Bucket to 25%
  // increments per channel so we get a handful of useful checkpoints
  // without flooding the console.
  const PROGRESS_BUCKET_PCT = 25;
  let lastTotalBucket = -1;
  const lastFileBucket = new Map<string, number>();

  return {
    dtype: EMBEDDING_DTYPE,
    progress_callback: (progress: ProgressInfo) => {
      switch (progress.status) {
        case "progress_total": {
          const pct = Math.round(progress.progress);
          const bucket = Math.floor(pct / PROGRESS_BUCKET_PCT);
          if (bucket === lastTotalBucket) break;
          lastTotalBucket = bucket;
          logDebug("embeddings.progress", {
            status: progress.status,
            percentage: pct,
          });
          break;
        }
        case "progress": {
          const pct = Math.round(progress.progress);
          const bucket = Math.floor(pct / PROGRESS_BUCKET_PCT);
          if (lastFileBucket.get(progress.file) === bucket) break;
          lastFileBucket.set(progress.file, bucket);
          logDebug("embeddings.progress", {
            status: progress.status,
            file: progress.file,
            percentage: pct,
          });
          break;
        }
        case "download":
          logInfo("embeddings.download", { file: progress.file });
          break;
        case "done":
          logInfo("embeddings.download-done", { file: progress.file });
          break;
        case "ready":
          logInfo("embeddings.ready");
          break;
      }
    },
  };
}

async function createPipelineInstance(): Promise<FeatureExtractionPipeline> {
  await preloadOnnxWasm();
  const baseOptions = buildPipelineOptions();
  const selectedDevice = await getInferenceDevice();
  if (selectedDevice.device === "webgpu") {
    try {
      return await pipeline<"feature-extraction">(
        "feature-extraction",
        EMBEDDING_MODEL_ID,
        { ...baseOptions, device: "webgpu" }
      );
    } catch (error) {
      logWarn("embeddings.webgpu-fallback", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return pipeline<"feature-extraction">(
    "feature-extraction",
    EMBEDDING_MODEL_ID,
    {
      ...baseOptions,
      device: "wasm",
    }
  );
}

function getInstance() {
  if (pipelineInstance === null) {
    logInfo("embeddings.load-start", { model: EMBEDDING_MODEL_ID });
    const start = Date.now();
    pipelineInstance = createPipelineInstance()
      .then((p) => {
        logInfo("embeddings.loaded", { elapsedMs: Date.now() - start });
        return p;
      })
      .catch((error) => {
        pipelineInstance = null;
        throw error;
      });
  }
  return pipelineInstance;
}

function disposeTensors(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if ("dispose" in value && typeof value.dispose === "function") {
    value.dispose();
    return;
  }
  for (const item of Object.values(value)) disposeTensors(item);
}

async function createRerankerInstance(): Promise<{
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
  device: InferenceDevice;
}> {
  await preloadOnnxWasm();
  const tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL_ID);
  const baseOptions = {
    dtype: RERANK_DTYPE,
    progress_callback: (progress: ProgressInfo) => {
      if (progress.status === "download") {
        logInfo("rerank.download", {
          prefix: RERANK_LOG_PREFIX,
          file: progress.file,
        });
      } else if (progress.status === "ready") {
        logInfo("rerank.ready", { prefix: RERANK_LOG_PREFIX });
      }
    },
  } as const;
  const selectedDevice = await getInferenceDevice();

  if (selectedDevice.device === "webgpu") {
    try {
      const model = await AutoModelForSequenceClassification.from_pretrained(
        RERANK_MODEL_ID,
        {
          ...baseOptions,
          device: "webgpu",
        }
      );
      return { tokenizer, model, device: "webgpu" };
    } catch (error) {
      logWarn("rerank.webgpu-fallback", {
        prefix: RERANK_LOG_PREFIX,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const model = await AutoModelForSequenceClassification.from_pretrained(
    RERANK_MODEL_ID,
    {
      ...baseOptions,
      device: "wasm",
    }
  );
  return { tokenizer, model, device: "wasm" };
}

function getRerankerInstance() {
  if (rerankerInstance === null) {
    const start = Date.now();
    logInfo("rerank.load-start", {
      prefix: RERANK_LOG_PREFIX,
      model: RERANK_MODEL_ID,
      dtype: RERANK_DTYPE,
    });
    rerankerInstance = createRerankerInstance()
      .then((instance) => {
        logInfo("rerank.loaded", {
          prefix: RERANK_LOG_PREFIX,
          elapsedMs: Date.now() - start,
          device: instance.device,
        });
        return instance;
      })
      .catch((error) => {
        rerankerInstance = null;
        throw error;
      });
  }
  return rerankerInstance;
}

// ── IndexedDB persistence layer ──────────────────────────────────────

function sanitizeCachePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]+/g, "-").replace(/^-|-$/g, "");
}

const IDB_NAME = `knoww-embeddings-${sanitizeCachePart(
  EMBEDDING_MODEL_ID
)}-${EMBEDDING_DTYPE}`;
const IDB_VERSION = 3;
const IDB_STORE = "vectors";
const IDB_MAX_ENTRIES = 2000;
const IDB_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface IDBEntry {
  text: string;
  vector: Float32Array | number[];
  ts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(IDB_STORE)) {
        db.deleteObjectStore(IDB_STORE);
      }
      const store = db.createObjectStore(IDB_STORE, { keyPath: "text" });
      store.createIndex("ts", "ts", { unique: false });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      logWarn("embeddings.idb-open-failed", { error: req.error });
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function toFloat32(v: Float32Array | number[]): Float32Array {
  return v instanceof Float32Array ? v : new Float32Array(v);
}

async function idbGetMany(texts: string[]): Promise<Map<string, Float32Array>> {
  const result = new Map<string, Float32Array>();
  if (texts.length === 0) return result;
  try {
    const db = await openDB();
    const now = Date.now();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      let pending = texts.length;
      for (const text of texts) {
        const req = store.get(text);
        req.onsuccess = () => {
          const entry = req.result as IDBEntry | undefined;
          if (entry && now - entry.ts < IDB_TTL_MS) {
            result.set(text, toFloat32(entry.vector));
          }
          if (--pending === 0) resolve(result);
        };
        req.onerror = () => {
          if (--pending === 0) resolve(result);
        };
      }
    });
  } catch {
    return result;
  }
}

async function idbPutMany(
  entries: Array<{ text: string; vector: Float32Array }>
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDB();
    const now = Date.now();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      for (const { text, vector } of entries) {
        store.put({ text, vector, ts: now } satisfies IDBEntry);
      }
      tx.oncomplete = () => {
        logDebug("embeddings.idb-put", {
          count: entries.length,
        });
        resolve();
      };
      tx.onerror = () => {
        logWarn("embeddings.idb-write-error", { error: tx.error });
        reject(tx.error);
      };
    });
  } catch (e) {
    logWarn("embeddings.idb-write-failed", { error: e });
  }
}

let lastPruneTime = 0;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // max once per hour

async function idbPruneIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneTime < PRUNE_INTERVAL_MS) return;
  lastPruneTime = now;

  try {
    const db = await openDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);

    // Delete expired entries, then cap total entries once the cursor completes
    const cutoff = now - IDB_TTL_MS;
    const idx = store.index("ts");
    const range = IDBKeyRange.upperBound(cutoff);
    const cursorReq = idx.openCursor(range);
    let deleted = 0;
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        deleted++;
        cursor.continue();
        return;
      }

      if (deleted > 0) {
        logDebug("embeddings.idb-prune", { deleted });
      }

      // Cap total entries — count now reflects the completed deletions above
      const countReq = store.count();
      countReq.onsuccess = () => {
        const total = countReq.result;
        if (total <= IDB_MAX_ENTRIES) return;
        const excess = total - IDB_MAX_ENTRIES;
        const oldestCursor = idx.openCursor();
        let removed = 0;
        oldestCursor.onsuccess = () => {
          const c = oldestCursor.result;
          if (c && removed < excess) {
            c.delete();
            removed++;
            c.continue();
          }
        };
      };
    };
  } catch {
    // best-effort
  }
}

// ── In-memory L1 cache ───────────────────────────────────────────────

const l1Cache = new LRUCache<string, Float32Array>(500);

// ── Embedding computation ────────────────────────────────────────────

function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  const sim = dot / denom;
  return Number.isFinite(sim) ? sim : 0;
}

const EMBEDDING_BATCH_SIZE = 8;

async function getEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const extractor = await getInstance();
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const output = await extractor(batch, {
      pooling: "cls",
      normalize: true,
    });
    try {
      const data = output.data as Float32Array;
      const dim = output.dims[1];
      for (let j = 0; j < batch.length; j++) {
        results.push(data.slice(j * dim, (j + 1) * dim));
      }
    } finally {
      output.dispose();
    }
  }

  return results;
}

export async function computeSimilarities(
  postText: string,
  marketTexts: string[]
): Promise<number[]> {
  const start = Date.now();

  const queryText = `Represent this sentence for searching relevant passages: ${postText}`;

  const allTexts = [queryText, ...marketTexts];
  const uniqueTexts = Array.from(new Set(allTexts));

  const local = new Map<string, Float32Array>();

  // L1: check in-memory cache
  const textsNotInL1: string[] = [];
  for (const text of uniqueTexts) {
    const cached = l1Cache.get(text);
    if (cached) {
      local.set(text, cached);
    } else {
      textsNotInL1.push(text);
    }
  }

  // L2: check IndexedDB for anything not in L1
  let idbHits = 0;
  if (textsNotInL1.length > 0) {
    const fromIdb = await idbGetMany(textsNotInL1);
    for (const [text, vector] of fromIdb) {
      l1Cache.set(text, vector);
      local.set(text, vector);
      idbHits++;
    }
  }

  // Compute embeddings only for texts missing from both caches
  const textsToEmbed: string[] = [];
  for (const text of uniqueTexts) {
    if (!local.has(text)) {
      textsToEmbed.push(text);
    }
  }

  if (textsToEmbed.length > 0) {
    const newEmbeddings = await getEmbeddings(textsToEmbed);
    const idbEntries: Array<{ text: string; vector: Float32Array }> = [];
    for (let i = 0; i < textsToEmbed.length; i++) {
      l1Cache.set(textsToEmbed[i], newEmbeddings[i]);
      local.set(textsToEmbed[i], newEmbeddings[i]);
      if (textsToEmbed[i] !== queryText) {
        idbEntries.push({ text: textsToEmbed[i], vector: newEmbeddings[i] });
      }
    }
    // Fire-and-forget: IDB persistence is not on the critical path
    idbPutMany(idbEntries).catch(() => {});
    idbPruneIfNeeded();
  }

  const postEmbedding = local.get(queryText);
  if (!postEmbedding) return [];

  const similarities = marketTexts.map((marketText) => {
    const marketEmbedding = local.get(marketText);
    if (!marketEmbedding) return 0;
    return cosineSimilarity(postEmbedding, marketEmbedding);
  });

  const l1Hits = uniqueTexts.length - textsNotInL1.length;
  const timeMs = Date.now() - start;
  logDebug("embeddings.scored", {
    count: marketTexts.length,
    elapsedMs: timeMs,
    l1Hits,
    idbHits,
    computed: textsToEmbed.length,
  });
  return similarities;
}

export interface RerankResult {
  scores: number[];
  metrics: {
    count: number;
    elapsedMs: number;
    queueWaitMs: number;
    model: string;
    dtype: string;
    device: "webgpu" | "wasm";
  };
}

async function runRerankMarketPairs(
  postText: string,
  marketTexts: string[],
  queueWaitMs: number
): Promise<RerankResult> {
  const start = Date.now();
  if (!postText || marketTexts.length === 0) {
    return {
      scores: [],
      metrics: {
        count: marketTexts.length,
        elapsedMs: 0,
        queueWaitMs,
        model: RERANK_MODEL_ID,
        dtype: RERANK_DTYPE,
        device: "wasm",
      },
    };
  }

  const { tokenizer, model, device } = await getRerankerInstance();
  const scores: number[] = [];

  for (let i = 0; i < marketTexts.length; i += RERANK_BATCH_SIZE) {
    const batch = marketTexts.slice(i, i + RERANK_BATCH_SIZE);
    const inputs = tokenizer(new Array<string>(batch.length).fill(postText), {
      text_pair: batch,
      padding: true,
      truncation: true,
    });

    try {
      const output = await model(inputs);
      const logits = output.logits;
      const width = logits.dims[logits.dims.length - 1] ?? 1;
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

  const elapsedMs = Date.now() - start;
  logInfo("rerank.scored", {
    prefix: RERANK_LOG_PREFIX,
    count: marketTexts.length,
    elapsedMs,
    queueWaitMs,
    device,
  });

  return {
    scores,
    metrics: {
      count: marketTexts.length,
      elapsedMs,
      queueWaitMs,
      model: RERANK_MODEL_ID,
      dtype: RERANK_DTYPE,
      device,
    },
  };
}

export async function rerankMarketPairs(
  postText: string,
  marketTexts: string[]
): Promise<RerankResult> {
  const queuedAt = Date.now();
  let releaseNext: () => void = () => {};
  const previous = rerankQueue;
  rerankQueue = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });

  await previous;
  const queueWaitMs = Date.now() - queuedAt;
  try {
    return await runRerankMarketPairs(postText, marketTexts, queueWaitMs);
  } finally {
    releaseNext();
  }
}

/**
 * Eagerly load the ONNX model so the first real inference is fast.
 * Call once from the offscreen document during idle time.
 */
export function warmUp(): Promise<void> {
  if (warmUpPromise) return warmUpPromise;

  warmUpPromise = getInstance()
    .then(async (extractor) => {
      const output = await extractor(["Knoww scoring warm-up"], {
        pooling: "cls",
        normalize: true,
      });
      output.dispose();
    })
    .catch((error) => {
      warmUpPromise = null;
      throw error;
    });

  return warmUpPromise;
}
