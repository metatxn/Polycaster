import type { BackgroundResponse } from "../types/chrome-messages";

const imageDataUrlCache = new Map<string, Promise<string | null>>();
const MAX_IMAGE_DATA_URL_CACHE_ENTRIES = 100;

export function shouldProxyImageUrl(url: string): boolean {
  try {
    if (!/^[a-z][a-z\d+.-]*:/i.test(url)) return false;
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function sendImageProxyMessage(url: string): Promise<BackgroundResponse> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) {
        resolve({ ok: false, error: "Extension context unavailable" });
        return;
      }

      chrome.runtime.sendMessage(
        { type: "fetch-image-data-url", url },
        (response: BackgroundResponse) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error:
                chrome.runtime.lastError.message || "Unknown runtime error",
            });
            return;
          }
          resolve(response || { ok: false, error: "No response" });
        }
      );
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export async function resolveCspSafeImageUrl(
  url: string
): Promise<string | null> {
  if (!shouldProxyImageUrl(url)) {
    return url;
  }

  const cached = imageDataUrlCache.get(url);
  if (cached) return cached;

  const request = (async () => {
    const response = await sendImageProxyMessage(url);
    if (!response.ok || !("dataUrl" in response)) {
      return null;
    }
    return typeof response.dataUrl === "string" ? response.dataUrl : null;
  })();

  imageDataUrlCache.set(url, request);
  if (imageDataUrlCache.size > MAX_IMAGE_DATA_URL_CACHE_ENTRIES) {
    const oldestKey = imageDataUrlCache.keys().next().value;
    if (oldestKey) imageDataUrlCache.delete(oldestKey);
  }

  request.catch(() => {
    imageDataUrlCache.delete(url);
  });

  return request;
}

export function setCspSafeImageSrc(
  img: HTMLImageElement,
  url: string,
  _onProxyFailure?: () => void
): void {
  if (!shouldProxyImageUrl(url)) {
    img.src = url;
    return;
  }

  void resolveCspSafeImageUrl(url)
    .then((resolvedUrl) => {
      if (resolvedUrl) {
        img.src = resolvedUrl;
      } else {
        img.src = url;
      }
    })
    .catch(() => {
      img.src = url;
    });
}
