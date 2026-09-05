const completeKey = (address: string) =>
  `knoww:setup-complete:${address.toLowerCase()}`;
const dismissedKey = (address: string) =>
  `knoww:setup-dismissed:${address.toLowerCase()}`;
const milestonesKey = (address: string) =>
  `knoww:setup-milestones:${address.toLowerCase()}`;

export interface SetupMilestones {
  tradingWalletDeployed: boolean;
  hasCredentials: boolean;
  hasApproval: boolean;
}

const EMPTY_SETUP_MILESTONES: SetupMilestones = {
  tradingWalletDeployed: false,
  hasCredentials: false,
  hasApproval: false,
};

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

export async function readSetupMilestones(
  address: string
): Promise<SetupMilestones> {
  const stored = await storageGet(milestonesKey(address));
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...EMPTY_SETUP_MILESTONES };
  }

  const milestones = stored as Partial<SetupMilestones>;
  return {
    tradingWalletDeployed: milestones.tradingWalletDeployed === true,
    hasCredentials: milestones.hasCredentials === true,
    hasApproval: milestones.hasApproval === true,
  };
}

export async function writeSetupMilestones(
  address: string,
  milestones: SetupMilestones
): Promise<void> {
  await storageSet(milestonesKey(address), {
    tradingWalletDeployed: milestones.tradingWalletDeployed === true,
    hasCredentials: milestones.hasCredentials === true,
    hasApproval: milestones.hasApproval === true,
  });
}
