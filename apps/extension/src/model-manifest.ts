export const CONTEXT_MODEL_MANIFEST = {
  manifestVersion: "context-models-v1",
  embedding: {
    id: "Snowflake/snowflake-arctic-embed-s",
    revision: "e596f507467533e48a2e17c007f0e1dacc837b33",
    dtype: "int8",
    pooling: "cls",
    queryPrefixVersion: "search-passages-v1",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    artifact: {
      path: "onnx/model_int8.onnx",
      bytes: 34_015_111,
      sha256:
        "f93ff225320628d2e88baf2a395cae791b0e3b27edf5c70bf7b312a4d3260c14",
    },
    tokenizer: {
      path: "tokenizer.json",
      bytes: 711_649,
      hubEtag: "3c0e6344ec45a9a6e5a621d6711baf109c2d9f87",
    },
    config: {
      path: "config.json",
      bytes: 703,
      hubEtag: "44dc4d3c660fd87dd1147355d74614615ce0ea8f",
    },
  },
  reranker: {
    id: "Xenova/ms-marco-MiniLM-L-6-v2",
    revision: "a09144355adeed5f58c8ed011d209bf8ee5a1fec",
    dtype: "q8",
    artifact: {
      path: "onnx/model_quantized.onnx",
      bytes: 23_143_499,
      sha256:
        "e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe",
    },
    tokenizer: {
      path: "tokenizer.json",
      bytes: 711_396,
      hubEtag: "688882a79f44442ddc1f60d70334a7ff5df0fb47",
    },
    config: {
      path: "config.json",
      bytes: 824,
      hubEtag: "e94e433dc05771d74530b4a5fdaf8f398da30cab",
    },
  },
} as const;

interface EmbeddingCacheContract {
  id: string;
  revision: string;
  dtype: string;
  pooling: string;
  queryPrefixVersion: string;
}

function sanitizeCachePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]+/g, "-").replace(/^-|-$/g, "");
}

export function buildEmbeddingCacheNamespace(
  contract: EmbeddingCacheContract
): string {
  return [
    CONTEXT_MODEL_MANIFEST.manifestVersion,
    contract.id,
    contract.revision,
    contract.dtype,
    contract.pooling,
    contract.queryPrefixVersion,
  ]
    .map(sanitizeCachePart)
    .join(".");
}
