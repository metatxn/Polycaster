import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const dispose = vi.fn();
  const extractor = vi.fn(async () => ({
    data: new Float32Array([1, 0]),
    dims: [1, 2],
    dispose,
  }));
  const pipeline = vi.fn(async () => extractor);

  return { dispose, extractor, pipeline };
});

vi.mock("@huggingface/transformers", () => ({
  AutoModelForSequenceClassification: {
    from_pretrained: vi.fn(),
  },
  AutoTokenizer: {
    from_pretrained: vi.fn(),
  },
  env: {
    allowLocalModels: true,
    backends: { onnx: { wasm: {} } },
    IS_WEBGPU_AVAILABLE: false,
    logLevel: null,
    useBrowserCache: false,
    useWasmCache: true,
  },
  LogLevel: { WARNING: "warning" },
  pipeline: mocks.pipeline,
}));

vi.mock("@knoww/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

test("warmUp performs one real inference and shares concurrent work", async () => {
  const { warmUp } = await import("../../src/background/embeddings");

  await Promise.all([warmUp(), warmUp()]);

  assert.equal(mocks.pipeline.mock.calls.length, 1);
  assert.equal(mocks.extractor.mock.calls.length, 1);
  assert.deepEqual(mocks.extractor.mock.calls[0], [
    ["Knoww scoring warm-up"],
    { normalize: true, pooling: "cls" },
  ]);
  assert.equal(mocks.dispose.mock.calls.length, 1);
});
