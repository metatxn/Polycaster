/**
 * Background-owned store for CLOB API credentials.
 *
 * Credentials live in `chrome.storage.session` keyed by wallet address and are
 * only ever read inside the service worker (order signing/placement already
 * happens there). Content scripts never receive the raw credential object —
 * they can only ask whether credentials exist (`hasClobCredentials`) — which
 * keeps trading credential material confined to the worker trust boundary.
 */

import type { ApiKeyCreds } from "@knoww/shared-types/polymarket";
import { TRADING_CREDS_STORAGE_PREFIX } from "./creds-guards";

export function clobCredentialsStorageKey(address: string): string {
  return `${TRADING_CREDS_STORAGE_PREFIX}${address.toLowerCase()}`;
}

function isApiKeyCreds(value: unknown): value is ApiKeyCreds {
  if (!value || typeof value !== "object") return false;
  const creds = value as Partial<ApiKeyCreds>;
  return (
    typeof creds.apiKey === "string" &&
    typeof creds.apiSecret === "string" &&
    typeof creds.apiPassphrase === "string"
  );
}

export async function loadClobCredentials(
  address: string
): Promise<ApiKeyCreds | null> {
  const key = clobCredentialsStorageKey(address);
  const result = await chrome.storage.session.get(key);
  const value = result[key];
  return isApiKeyCreds(value) ? value : null;
}

export async function storeClobCredentials(
  address: string,
  credentials: ApiKeyCreds
): Promise<void> {
  await chrome.storage.session.set({
    [clobCredentialsStorageKey(address)]: credentials,
  });
}

export async function hasClobCredentials(address: string): Promise<boolean> {
  return (await loadClobCredentials(address)) !== null;
}

export async function removeClobCredentials(address: string): Promise<void> {
  await chrome.storage.session.remove(clobCredentialsStorageKey(address));
}
