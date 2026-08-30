import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { CONTEXT_MODEL_MANIFEST } from "../../src/model-manifest";

const mocks = vi.hoisted(() => {
  const dispose = vi.fn();
  const extractor = vi.fn(async () => ({
    data: new Float32Array([1, 0]),
    dims: [1, 2],
    dispose,
  }));
  const pipeline = vi.fn(
    async (
      _task: string,
      _model: string,
      _options: { device?: "webgpu" | "wasm" }
    ) => extractor
  );
  const gpuDevice = { destroy: vi.fn() };
  const requestDevice = vi.fn(async () => gpuDevice);
  const requestAdapter = vi.fn(async () => ({ requestDevice }));
  const tokenizer = vi.fn(() => ({ dispose: vi.fn() }));
  const model = vi.fn(async () => ({
    dispose: vi.fn(),
    logits: { data: new Float32Array([0.75]), dims: [1, 1] },
  }));
  const tokenizerFromPretrained = vi.fn(async () => tokenizer);
  const modelFromPretrained = vi.fn(async () => model);
  const transformersEnv = {
    allowLocalModels: true,
    backends: { onnx: { wasm: {}, webgpu: {} } },
    IS_WEBGPU_AVAILABLE: false,
    logLevel: null,
    useBrowserCache: false,
    useWasmCache: true,
  };

  return {
    dispose,
    extractor,
    gpuDevice,
    model,
    modelFromPretrained,
    pipeline,
    requestAdapter,
    requestDevice,
    tokenizer,
    tokenizerFromPretrained,
    transformersEnv,
  };
});

vi.mock("@huggingface/transformers", () => ({
  AutoModelForSequenceClassification: {
    from_pretrained: mocks.modelFromPretrained,
  },
  AutoTokenizer: {
    from_pretrained: mocks.tokenizerFromPretrained,
  },
  env: mocks.transformersEnv,
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
  mocks.pipeline.mockResolvedValue(mocks.extractor);
  mocks.requestDevice.mockResolvedValue(mocks.gpuDevice);
  mocks.requestAdapter.mockResolvedValue({
    requestDevice: mocks.requestDevice,
  });
  mocks.tokenizerFromPretrained.mockResolvedValue(mocks.tokenizer);
  mocks.modelFromPretrained.mockResolvedValue(mocks.model);
  mocks.transformersEnv.backends.onnx.webgpu = {};
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function enableWebGpu(): void {
  vi.stubGlobal("navigator", {
    gpu: { requestAdapter: mocks.requestAdapter },
    hardwareConcurrency: 8,
  });
}

function selectedPipelineDevices(): Array<"webgpu" | "wasm" | undefined> {
  return mocks.pipeline.mock.calls.map((call) => call[2]?.device);
}

test("warmUp loads the embedding model at the pinned revision", async () => {
  const { warmUp } = await import("../../src/background/embeddings");

  await warmUp();

  assert.equal(
    mocks.pipeline.mock.calls[0]?.[1],
    CONTEXT_MODEL_MANIFEST.embedding.id
  );
  assert.equal(
    mocks.pipeline.mock.calls[0]?.[2]?.revision,
    CONTEXT_MODEL_MANIFEST.embedding.revision
  );
});

test("reranking loads the tokenizer and model at the pinned revision", async () => {
  const { rerankMarketPairs } = await import("../../src/background/embeddings");

  await rerankMarketPairs("AI update", ["Will an AI model launch?"]);

  assert.deepEqual(mocks.tokenizerFromPretrained.mock.calls[0], [
    CONTEXT_MODEL_MANIFEST.reranker.id,
    { revision: CONTEXT_MODEL_MANIFEST.reranker.revision },
  ]);
  assert.equal(
    mocks.modelFromPretrained.mock.calls[0]?.[0],
    CONTEXT_MODEL_MANIFEST.reranker.id
  );
  assert.equal(
    mocks.modelFromPretrained.mock.calls[0]?.[1]?.revision,
    CONTEXT_MODEL_MANIFEST.reranker.revision
  );
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

test("warmUp uses a verified WebGPU device", async () => {
  enableWebGpu();
  const { warmUp } = await import("../../src/background/embeddings");

  await warmUp();

  assert.equal(mocks.requestAdapter.mock.calls.length, 1);
  assert.equal(mocks.requestDevice.mock.calls.length, 1);
  assert.equal(
    mocks.transformersEnv.backends.onnx.webgpu.device,
    mocks.gpuDevice
  );
  assert.deepEqual(selectedPipelineDevices(), ["webgpu"]);
});

test("warmUp uses WASM when WebGPU returns no adapter", async () => {
  enableWebGpu();
  mocks.requestAdapter.mockResolvedValueOnce(null);
  const { warmUp } = await import("../../src/background/embeddings");

  await warmUp();

  assert.equal(mocks.requestDevice.mock.calls.length, 0);
  assert.deepEqual(selectedPipelineDevices(), ["wasm"]);
});

test("warmUp uses WASM when WebGPU probing rejects", async () => {
  enableWebGpu();
  mocks.requestAdapter.mockRejectedValueOnce(new Error("adapter unavailable"));
  const { warmUp } = await import("../../src/background/embeddings");

  await warmUp();

  assert.deepEqual(selectedPipelineDevices(), ["wasm"]);
});

test("warmUp uses WASM when the WebGPU adapter probe stays pending", async () => {
  vi.useFakeTimers();
  enableWebGpu();
  mocks.requestAdapter.mockReturnValueOnce(new Promise(() => {}));
  const { warmUp } = await import("../../src/background/embeddings");

  const result = warmUp();
  await vi.advanceTimersByTimeAsync(1_499);
  assert.equal(mocks.pipeline.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  await result;

  assert.deepEqual(selectedPipelineDevices(), ["wasm"]);
});

test("warmUp uses WASM when the WebGPU device probe stays pending", async () => {
  vi.useFakeTimers();
  enableWebGpu();
  let resolveDevice!: (device: typeof mocks.gpuDevice) => void;
  mocks.requestDevice.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveDevice = resolve;
    })
  );
  const { warmUp } = await import("../../src/background/embeddings");

  const result = warmUp();
  await vi.advanceTimersByTimeAsync(2_000);
  await result;

  assert.deepEqual(selectedPipelineDevices(), ["wasm"]);
  resolveDevice(mocks.gpuDevice);
  await Promise.resolve();
  assert.equal(mocks.gpuDevice.destroy.mock.calls.length, 1);
});

test("warmUp falls back to WASM when WebGPU model loading rejects", async () => {
  enableWebGpu();
  mocks.pipeline.mockImplementationOnce(async () => {
    throw new Error("webgpu session failed");
  });
  const { warmUp } = await import("../../src/background/embeddings");

  await warmUp();

  assert.deepEqual(selectedPipelineDevices(), ["webgpu", "wasm"]);
});
