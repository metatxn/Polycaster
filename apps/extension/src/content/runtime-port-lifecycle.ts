interface RuntimeLastErrorPort {
  readonly lastError?: { readonly message?: string };
}

interface RuntimeDisconnectPort {
  readonly onDisconnect: {
    addListener(listener: () => void): void;
  };
}

/**
 * Installs cleanup for a long-lived runtime port and consumes the transient
 * runtime error Chrome exposes when a page enters the back/forward cache.
 */
export function installRuntimePortDisconnectHandler(
  port: RuntimeDisconnectPort,
  cleanup: () => void,
  runtime: RuntimeLastErrorPort = chrome.runtime
): void {
  port.onDisconnect.addListener(() => {
    void runtime.lastError;
    cleanup();
  });
}
