import { isOnboardingWalletSetupUrl } from "./onboarding-state";

// This content script only mounts packaged UI. It does not forward page messages
// into the extension runtime or expose wallet/session data to the website.
if (isOnboardingWalletSetupUrl(location.href)) {
  const mount = () => {
    const slot = document.getElementById("knoww-extension-onboarding");
    if (slot?.dataset.ready !== "true" || slot.querySelector("iframe"))
      return;
    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL("onboarding.html?embedded=1");
    frame.title = "Knoww extension setup";
    frame.style.cssText =
      "display:block;position:absolute;visibility:hidden;width:100%;height:100%;border:0;background:transparent";
    window.addEventListener("message", (event) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== chrome.runtime.getURL("").replace(/\/$/, "") ||
        event.data?.type !== "knoww:onboarding-height"
      )
        return;
      const height = event.data.height;
      if (typeof height === "number" && Number.isFinite(height)) {
        frame.style.position = "static";
        frame.style.visibility = "visible";
        const fallback = document.getElementById(
          "knoww-extension-onboarding-fallback"
        );
        if (fallback) fallback.hidden = true;
      }
    });
    slot.append(frame);
  };
  mount();
  new MutationObserver(mount).observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ["data-ready"],
    subtree: true,
  });
}
