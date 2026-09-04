interface OnboardingDemoResponse {
  ok?: boolean;
  data?: {
    accepted?: boolean;
    showGuide?: boolean;
  };
}

function sendDemoMilestone(
  type:
    | "KNOWW_ONBOARDING_DEMO_MARKET_INJECTED"
    | "KNOWW_ONBOARDING_DEMO_MARKET_CLICKED",
  marketId: string,
  callback?: (response: OnboardingDemoResponse) => void
): void {
  chrome.runtime.sendMessage({ type, marketId }, (response) => {
    if (chrome.runtime.lastError) return;
    callback?.(response as OnboardingDemoResponse);
  });
}

function addDemoGuide(card: HTMLElement, marketId: string): void {
  if (card.dataset.knowwOnboardingGuide === "true") return;
  card.dataset.knowwOnboardingGuide = "true";

  const guide = document.createElement("div");
  guide.className = "knoww-onboarding-demo-guide";
  guide.setAttribute("role", "status");

  const badge = document.createElement("span");
  badge.className = "knoww-onboarding-demo-guide__badge";
  badge.textContent = "Your first Knoww market";

  const instruction = document.createElement("span");
  instruction.className = "knoww-onboarding-demo-guide__instruction";
  instruction.textContent = "Open it to see probabilities and outcomes";

  guide.append(badge, instruction);
  card.prepend(guide);
  card.classList.add("knoww-onboarding-demo-card");
  card.addEventListener(
    "click",
    () => {
      sendDemoMilestone("KNOWW_ONBOARDING_DEMO_MARKET_CLICKED", marketId);
      guide.remove();
      card.classList.remove("knoww-onboarding-demo-card");
    },
    { once: true, capture: true }
  );
}

export function registerOnboardingDemoMarket(
  card: HTMLElement,
  marketId: string
): void {
  if (
    window.location.hostname !== "x.com" ||
    !window.location.pathname.startsWith("/polymarket")
  ) {
    return;
  }
  if (card.dataset.knowwOnboardingDemoRegistered === "true") return;
  card.dataset.knowwOnboardingDemoRegistered = "true";

  sendDemoMilestone(
    "KNOWW_ONBOARDING_DEMO_MARKET_INJECTED",
    marketId,
    (response) => {
      if (response.ok === true && response.data?.showGuide === true) {
        addDemoGuide(card, marketId);
      }
    }
  );
}
