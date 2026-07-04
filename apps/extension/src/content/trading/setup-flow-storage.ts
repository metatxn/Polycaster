const completeKey = (address: string) =>
  `knoww:setup-complete:${address.toLowerCase()}`;
const dismissedKey = (address: string) =>
  `knoww:setup-dismissed:${address.toLowerCase()}`;

function storageGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve(undefined);
      return;
    }
    chrome.storage.local.get(key, (result) => resolve(result?.[key]));
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      resolve();
      return;
    }
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

export async function readSetupComplete(address: string): Promise<boolean> {
  return (await storageGet(completeKey(address))) === true;
}

export async function writeSetupComplete(
  address: string,
  complete: boolean
): Promise<void> {
  await storageSet(completeKey(address), complete);
}

export async function markSetupComplete(address: string): Promise<void> {
  await writeSetupComplete(address, true);
}

export async function readSetupDismissed(address: string): Promise<boolean> {
  return (await storageGet(dismissedKey(address))) === true;
}

export async function writeSetupDismissed(
  address: string,
  dismissed: boolean
): Promise<void> {
  await storageSet(dismissedKey(address), dismissed);
}
