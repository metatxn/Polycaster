import { env } from "@huggingface/transformers";
import { logInfo, logWarn } from "@knoww/logger";

const WEBGPU_PROBE_TIMEOUT_MS = 1_500;

export type InferenceDevice = "webgpu" | "wasm";

interface WebGpuApiLike {
  requestAdapter(options?: {
    powerPreference?: "high-performance" | "low-power";
  }): Promise<GPUAdapter | null>;
}

type InferenceDeviceSelection =
  | {
      device: "webgpu";
      elapsedMs: number;
      gpuDevice: GPUDevice;
      reason: "device-ready";
    }
  | {
      device: "wasm";
      elapsedMs: number;
      message?: string;
      reason:
        | "api-unavailable"
        | "adapter-unavailable"
        | "backend-unavailable"
        | "probe-failed"
        | "probe-timeout";
    };

let inferenceDevicePromise: Promise<InferenceDeviceSelection> | null = null;

function getWebGpuApi(): WebGpuApiLike | null {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;
  const gpu = (navigator as typeof navigator & { gpu?: WebGpuApiLike }).gpu;
  return typeof gpu?.requestAdapter === "function" ? gpu : null;
}

async function probeWebGpuDevice(): Promise<InferenceDeviceSelection> {
  const startedAt = Date.now();
  const gpu = getWebGpuApi();
  if (!gpu) {
    return {
      device: "wasm",
      elapsedMs: Date.now() - startedAt,
      reason: "api-unavailable",
    };
  }

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = (): InferenceDeviceSelection => ({
    device: "wasm",
    elapsedMs: Date.now() - startedAt,
    reason: "probe-timeout",
  });

  const probe = (async (): Promise<InferenceDeviceSelection> => {
    try {
      const adapter = await gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (timedOut) return timeoutResult();
      if (!adapter) {
        return {
          device: "wasm",
          elapsedMs: Date.now() - startedAt,
          reason: "adapter-unavailable",
        };
      }

      const gpuDevice = await adapter.requestDevice();
      if (timedOut) {
        gpuDevice.destroy();
        return timeoutResult();
      }

      return {
        device: "webgpu",
        elapsedMs: Date.now() - startedAt,
        gpuDevice,
        reason: "device-ready",
      };
    } catch (error) {
      return {
        device: "wasm",
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
        reason: "probe-failed",
      };
    }
  })();

  const timeout = new Promise<InferenceDeviceSelection>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve(timeoutResult());
    }, WEBGPU_PROBE_TIMEOUT_MS);
  });

  const selection = await Promise.race([probe, timeout]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  return selection;
}

export function getInferenceDevice(): Promise<InferenceDeviceSelection> {
  if (inferenceDevicePromise) return inferenceDevicePromise;

  inferenceDevicePromise = probeWebGpuDevice().then((selection) => {
    let resolved = selection;
    if (selection.device === "webgpu") {
      const webgpu = (
        env.backends.onnx as typeof env.backends.onnx & {
          webgpu?: { device?: unknown };
        }
      ).webgpu;

      if (!webgpu) {
        selection.gpuDevice.destroy();
        resolved = {
          device: "wasm",
          elapsedMs: selection.elapsedMs,
          reason: "backend-unavailable",
        };
      } else {
        // ONNX Runtime recommends supplying a GPUDevice before the first
        // inference session instead of configuring its deprecated adapter.
        // Source: https://onnxruntime.ai/docs/api/js/interfaces/Env.WebGpuFlags.html
        webgpu.device = selection.gpuDevice;
      }
    }

    logInfo("embeddings.device-selected", {
      device: resolved.device,
      elapsedMs: resolved.elapsedMs,
      reason: resolved.reason,
    });
    if (resolved.device === "wasm" && resolved.message) {
      logWarn("embeddings.webgpu-probe-failed", {
        message: resolved.message,
      });
    }
    return resolved;
  });

  return inferenceDevicePromise;
}
