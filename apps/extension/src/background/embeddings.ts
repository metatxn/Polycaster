import {
  env,
  type FeatureExtractionPipeline,
  pipeline,
} from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

let pipelineInstance: Promise<FeatureExtractionPipeline> | null = null;

function getInstance() {
  if (pipelineInstance === null) {
    console.log("[Knoww Embeddings] Loading model Xenova/all-MiniLM-L6-v2...");
    const start = Date.now();
    pipelineInstance = pipeline<"feature-extraction">(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      {
        dtype: "q4",
        progress_callback: (progress: any) => {
          if (
            progress.status === "download" ||
            progress.status === "progress"
          ) {
            console.log(
              `[Knoww Embeddings] ${progress.status}: ${progress.file ?? ""} ${progress.progress ? `${Math.round(progress.progress)}%` : ""}`
            );
          } else if (
            progress.status === "done" ||
            progress.status === "ready"
          ) {
            console.log(
              `[Knoww Embeddings] ${progress.status}: ${progress.file ?? ""}`
            );
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

const embeddingCache = new LRUCache<string, number[]>(500);

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
  const allTexts = [postText, ...marketTexts];
  const textsToEmbed: string[] = [];

  // 1. Check cache for existing embeddings (use has() to avoid promoting LRU order)
  for (const text of allTexts) {
    if (!embeddingCache.has(text)) {
      textsToEmbed.push(text);
    }
  }

  // 2. Compute missing embeddings in one batch
  if (textsToEmbed.length > 0) {
    const newEmbeddings = await getEmbeddings(textsToEmbed);
    for (let i = 0; i < textsToEmbed.length; i++) {
      embeddingCache.set(textsToEmbed[i], newEmbeddings[i]);
    }
  }

  // 3. Retrieve all embeddings from cache
  const postEmbedding = embeddingCache.get(postText);
  if (!postEmbedding) return []; // Should never happen

  const similarities = marketTexts.map((marketText) => {
    const marketEmbedding = embeddingCache.get(marketText);
    if (!marketEmbedding) return 0;
    return cosineSimilarity(postEmbedding, marketEmbedding);
  });

  const timeMs = Date.now() - start;
  console.log(
    `[Knoww Embeddings] Scored ${marketTexts.length} markets in ${timeMs}ms (Cache hits: ${allTexts.length - textsToEmbed.length}/${allTexts.length})`
  );
  return similarities;
}
