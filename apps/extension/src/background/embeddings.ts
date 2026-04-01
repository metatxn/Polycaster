import {
  env,
  type FeatureExtractionPipeline,
  LogLevel,
  type ProgressInfo,
  pipeline,
} from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;
env.logLevel = LogLevel.WARNING;

let pipelineInstance: Promise<FeatureExtractionPipeline> | null = null;

function getInstance() {
  if (pipelineInstance === null) {
    console.log(
      "[Knoww Embeddings] Loading model onnx-community/bge-small-en-v1.5-ONNX..."
    );
    const start = Date.now();
    pipelineInstance = pipeline<"feature-extraction">(
      "feature-extraction",
      "onnx-community/bge-small-en-v1.5-ONNX",
      {
        dtype: "q4",
        progress_callback: (progress: ProgressInfo) => {
          switch (progress.status) {
            case "progress_total":
              console.log(
                `[Knoww Embeddings] Overall: ${Math.round(progress.progress)}%`
              );
              break;
            case "progress":
              console.log(
                `[Knoww Embeddings] progress: ${progress.file} ${Math.round(progress.progress)}%`
              );
              break;
            case "download":
              console.log(`[Knoww Embeddings] download: ${progress.file}`);
              break;
            case "done":
              console.log(`[Knoww Embeddings] done: ${progress.file}`);
              break;
            case "ready":
              console.log("[Knoww Embeddings] ready");
              break;
          }
        },
      }
    ).then((p) => {
      console.log(`[Knoww Embeddings] Model loaded in ${Date.now() - start}ms`);
      return p;
    });
  }
  return pipelineInstance;
}

// ── IndexedDB persistence layer ──────────────────────────────────────

const IDB_NAME = "knoww-embeddings";
const IDB_VERSION = 2;
const IDB_STORE = "vectors";
const IDB_MAX_ENTRIES = 2000;
const IDB_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface IDBEntry {
  text: string;
  vector: number[];
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
      console.warn("[Knoww Embeddings] IndexedDB open failed:", req.error);
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function idbGetMany(texts: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
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
            result.set(text, entry.vector);
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
  entries: Array<{ text: string; vector: number[] }>
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
        console.log(
          `[Knoww Embeddings] IDB persisted ${entries.length} vectors`
        );
        resolve();
      };
      tx.onerror = () => {
        console.warn("[Knoww Embeddings] IDB write error:", tx.error);
        reject(tx.error);
      };
    });
  } catch (e) {
    console.warn("[Knoww Embeddings] IDB write failed:", e);
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
        console.log(`[Knoww Embeddings] IDB pruned ${deleted} expired entries`);
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

class LRUCache<K, V> {
  private max: number;
  private cache: Map<K, V>;

  constructor(max = 1000) {
    this.max = max;
    this.cache = new Map();
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  get(key: K): V | undefined {
    const item = this.cache.get(key);
    if (item !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  set(key: K, val: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, val);
  }
}

const l1Cache = new LRUCache<string, number[]>(500);

// ── Embedding computation ────────────────────────────────────────────

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const extractor = await getInstance();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

export async function computeSimilarities(
  postText: string,
  marketTexts: string[]
): Promise<number[]> {
  const start = Date.now();

  // BGE models perform best when the query is prefixed with an instruction.
  const queryText = `Represent this sentence for searching relevant prediction markets: ${postText}`;

  const allTexts = [queryText, ...marketTexts];

  // Local map immune to LRU eviction — used for the final similarity lookup
  const local = new Map<string, number[]>();

  // L1: check in-memory cache
  const textsNotInL1: string[] = [];
  for (const text of allTexts) {
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
  for (const text of allTexts) {
    if (!local.has(text)) {
      textsToEmbed.push(text);
    }
  }

  if (textsToEmbed.length > 0) {
    const newEmbeddings = await getEmbeddings(textsToEmbed);
    const idbEntries: Array<{ text: string; vector: number[] }> = [];
    for (let i = 0; i < textsToEmbed.length; i++) {
      l1Cache.set(textsToEmbed[i], newEmbeddings[i]);
      local.set(textsToEmbed[i], newEmbeddings[i]);
      if (textsToEmbed[i] !== queryText) {
        idbEntries.push({ text: textsToEmbed[i], vector: newEmbeddings[i] });
      }
    }
    await idbPutMany(idbEntries);
    idbPruneIfNeeded();
  }

  const postEmbedding = local.get(queryText);
  if (!postEmbedding) return [];

  const similarities = marketTexts.map((marketText) => {
    const marketEmbedding = local.get(marketText);
    if (!marketEmbedding) return 0;
    return cosineSimilarity(postEmbedding, marketEmbedding);
  });

  const l1Hits = allTexts.length - textsNotInL1.length;
  const timeMs = Date.now() - start;
  console.log(
    `[Knoww Embeddings] Scored ${marketTexts.length} markets in ${timeMs}ms (L1: ${l1Hits}, IDB: ${idbHits}, computed: ${textsToEmbed.length})`
  );
  return similarities;
}
