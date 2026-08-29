export const WELCOME_MAX_VISIBLE_MS = 3_000;

type VisibilityElement = Pick<HTMLElement, "style">;

export function showWelcomeForUpTo(
  welcomeEl: VisibilityElement,
  scanningEl: VisibilityElement,
  onHidden: () => void
): () => void {
  let hidden = false;
  let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  const hide = (): void => {
    if (hidden) return;
    hidden = true;

    if (autoDismissTimer !== null) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }

    welcomeEl.style.setProperty("display", "none", "important");
    scanningEl.style.removeProperty("display");
    onHidden();
  };

  welcomeEl.style.removeProperty("display");
  scanningEl.style.setProperty("display", "none", "important");
  autoDismissTimer = setTimeout(hide, WELCOME_MAX_VISIBLE_MS);

  return hide;
}
