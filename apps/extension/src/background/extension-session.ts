import { decodeExtensionSessionAddress } from "./extension-session-token";

const KNOWW_APP_URL = __DEV_MODE__
  ? "http://localhost:8000"
  : "https://knoww.app";
const ACCESS_TOKEN_KEY = "knoww_extension_access_token";

function getSessionValue<T>(key: string): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.storage.session.get(key, (result) => {
      resolve((result[key] as T | undefined) ?? null);
    });
  });
}

function setSessionValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [key]: value }, () => resolve());
  });
}

function removeSessionValue(key: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.remove(key, () => resolve());
  });
}

export function getKnowwAppUrl(): string {
  return KNOWW_APP_URL;
}

export function isKnowwApiUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const baseUrl = new URL(KNOWW_APP_URL);
    return url.host === baseUrl.host && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export async function getExtensionAccessToken(): Promise<string | null> {
  const token = await getSessionValue<string>(ACCESS_TOKEN_KEY);
  return typeof token === "string" && token.length > 0 ? token : null;
}

export async function setExtensionAccessToken(token: string): Promise<void> {
  await setSessionValue(ACCESS_TOKEN_KEY, token);
}

export async function clearExtensionAccessToken(): Promise<void> {
  await removeSessionValue(ACCESS_TOKEN_KEY);
}

export async function getExtensionAuthorizationHeader(): Promise<
  string | null
> {
  const token = await getExtensionAccessToken();
  return token ? `Bearer ${token}` : null;
}

export interface ExtensionSessionInfo {
  loggedIn: boolean;
  address: string | null;
}

/**
 * Derived, non-secret session facts for callers that previously fetched the
 * raw token: whether the user is logged in, and the wallet address embedded in
 * the session token. The raw bearer never leaves the worker.
 */
export async function getExtensionSessionInfo(): Promise<ExtensionSessionInfo> {
  const token = await getExtensionAccessToken();
  if (!token) return { loggedIn: false, address: null };
  return { loggedIn: true, address: decodeExtensionSessionAddress(token) };
}
