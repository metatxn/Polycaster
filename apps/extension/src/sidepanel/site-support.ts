import { normalizeSiteSupportHostname } from "../site-support";
import { type RuntimeResponse, sendRuntimeMessage } from "./messaging";

export const SITE_SUPPORT_STYLES = `
  .knoww-site-support {
    min-height: 100vh;
    box-sizing: border-box;
    padding: 20px;
    color: #f4efe2;
    background: #14110d;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .knoww-site-support-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 34px;
  }
  .knoww-site-support-logo { width: 24px; height: 24px; border-radius: 6px; }
  .knoww-site-support-brand { font-size: 15px; font-weight: 650; }
  .knoww-site-support-card {
    max-width: 420px;
    margin: 0 auto;
    padding: 26px 22px;
    border: 1px solid rgba(232, 227, 216, 0.12);
    border-radius: 10px;
    background: #1b1813;
  }
  .knoww-site-support-eyebrow {
    margin: 0 0 10px;
    color: #a39c8a;
    font-family: "KnowwMono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .knoww-site-support-title {
    margin: 0;
    font-family: "KnowwEditorial", Georgia, serif;
    color: #f4efe2;
    font-size: 27px;
    font-style: italic;
    font-weight: 500;
    line-height: 1.1;
  }
  .knoww-site-support-copy {
    margin: 14px 0 0;
    color: #d8d2c2;
    font-size: 14px;
    line-height: 1.55;
  }
  .knoww-site-support-hostname {
    display: inline-block;
    max-width: 100%;
    margin-top: 18px;
    padding: 8px 10px;
    overflow: hidden;
    border: 1px solid rgba(232, 227, 216, 0.22);
    border-radius: 6px;
    color: #f4efe2;
    background: #201c17;
    font-family: "KnowwMono", ui-monospace, monospace;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .knoww-site-support-submit {
    width: 100%;
    margin-top: 22px;
    padding: 11px 16px;
    border: 0;
    border: 1px solid #f4efe2;
    border-radius: 6px;
    color: #14110d;
    background: #f4efe2;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .knoww-site-support-submit:disabled { cursor: default; opacity: 0.55; }
  .knoww-site-support-privacy,
  .knoww-site-support-status {
    margin: 10px 0 0;
    color: #a39c8a;
    font-size: 11px;
    line-height: 1.45;
  }
  .knoww-site-support-status { min-height: 16px; color: #d8d2c2; }
  .knoww-site-support-back {
    margin-top: 18px;
    padding: 0;
    border: 0;
    color: #d8d2c2;
    background: transparent;
    font-size: 13px;
    cursor: pointer;
  }
`;

export function renderSiteSupportSurface(): string {
  return `
    <section class="knoww-site-support" data-site-support-surface hidden>
      <header class="knoww-site-support-header">
        <img class="knoww-site-support-logo" src="icons/icon-128.png" alt="" width="24" height="24" />
        <span class="knoww-site-support-brand">Knoww</span>
      </header>
      <div class="knoww-site-support-card">
        <p class="knoww-site-support-eyebrow">Website not supported yet</p>
        <h1 class="knoww-site-support-title">Want Knoww here?</h1>
        <p class="knoww-site-support-copy">Tell us where you would like to see relevant prediction markets.</p>
        <span class="knoww-site-support-hostname" data-site-support-hostname></span>
        <button type="button" class="knoww-site-support-submit" data-site-support-submit>Request support for this website</button>
        <p class="knoww-site-support-privacy">This sends only the domain shown above, not the page address or its contents.</p>
        <p class="knoww-site-support-status" data-site-support-status role="status" aria-live="polite"></p>
        <button type="button" class="knoww-site-support-back" data-site-support-back>Back to markets</button>
      </div>
    </section>`;
}

export interface SiteSupportSurfaceHandle {
  show(hostname: string): void;
  hide(): void;
  dispose(): void;
}

export function createSiteSupportSurface(
  root: HTMLElement,
  ports: {
    send(message: Record<string, unknown>): Promise<RuntimeResponse>;
  } = { send: sendRuntimeMessage }
): SiteSupportSurfaceHandle {
  const main = root.querySelector<HTMLElement>("[data-sidepanel-main]");
  const surface = root.querySelector<HTMLElement>(
    "[data-site-support-surface]"
  );
  const hostnameLabel = root.querySelector<HTMLElement>(
    "[data-site-support-hostname]"
  );
  const status = root.querySelector<HTMLElement>("[data-site-support-status]");
  const submit = root.querySelector<HTMLButtonElement>(
    "[data-site-support-submit]"
  );
  const back = root.querySelector<HTMLButtonElement>(
    "[data-site-support-back]"
  );
  let currentHostname: string | null = null;
  let submitting = false;
  const submittedHostnames = new Set<string>();

  const show = (hostname: string): void => {
    const normalized = normalizeSiteSupportHostname(hostname);
    if (!normalized || !surface) return;
    currentHostname = normalized;
    if (hostnameLabel) hostnameLabel.textContent = normalized;
    if (status) {
      status.textContent = submittedHostnames.has(normalized)
        ? "Thanks — your request has been sent."
        : "";
    }
    if (submit) submit.disabled = submittedHostnames.has(normalized);
    if (main) main.hidden = true;
    surface.hidden = false;
  };

  const hide = (): void => {
    if (surface) surface.hidden = true;
    if (main) main.hidden = false;
  };

  const onSubmit = (): void => {
    if (
      !currentHostname ||
      submitting ||
      submittedHostnames.has(currentHostname)
    )
      return;
    const requestedHostname = currentHostname;
    submitting = true;
    if (submit) submit.disabled = true;
    if (status) status.textContent = "Sending your request…";

    void ports
      .send({ type: "site-support:request", hostname: requestedHostname })
      .then((response) => {
        if (response.ok === false) throw new Error("request failed");
        submittedHostnames.add(requestedHostname);
        if (status) status.textContent = "Thanks — your request has been sent.";
      })
      .catch(() => {
        if (status) {
          status.textContent =
            "We couldn't send your request. Please try again.";
        }
        if (submit) submit.disabled = false;
      })
      .finally(() => {
        submitting = false;
      });
  };

  submit?.addEventListener("click", onSubmit);
  back?.addEventListener("click", hide);

  return {
    show,
    hide,
    dispose() {
      submit?.removeEventListener("click", onSubmit);
      back?.removeEventListener("click", hide);
    },
  };
}
