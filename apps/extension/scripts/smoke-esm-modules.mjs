import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const extensionRoot = path.resolve(path.dirname(scriptPath), "..");
const manifestPath = path.join(
  extensionRoot,
  "src/content/platforms/manifest.json"
);
const childSuccessToken = "KNOWW_ESM_SMOKE_CHILD_OK_V1";
const childSuccessOutput = `${childSuccessToken}\n`;
const smokeBridgeNonce = "knoww-smoke-bridge-nonce";
const realModuleTimeoutMs = 10_000;
const controlTimeoutMs = 500;

async function runIsolatedImport(
  mode,
  modulePath,
  expectedName = "",
  { timeoutMs = realModuleTimeoutMs } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath, "--child", mode, modulePath, expectedName],
      { cwd: extensionRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, signal) => {
      finish(() => resolve({ code, signal, stdout, stderr, timedOut }));
    });
  });
}

function childProtocolError(result) {
  const errors = [];
  if (result.timedOut) errors.push("timed out");
  if (result.signal !== null) errors.push(`terminated by ${result.signal}`);
  if (result.code !== 0) errors.push(`exited with ${String(result.code)}`);
  if (result.stderr !== "") {
    errors.push(`unexpected stderr: ${JSON.stringify(result.stderr)}`);
  }
  if (result.stdout !== childSuccessOutput) {
    errors.push(
      `unexpected stdout: expected ${JSON.stringify(childSuccessOutput)}, received ${JSON.stringify(result.stdout)}`
    );
  }
  return errors.length > 0 ? errors.join("; ") : null;
}

function formatProperty(property) {
  return typeof property === "symbol" ? property.toString() : String(property);
}

function formatObservation(observation) {
  if (observation.kind === "listener") {
    return `${observation.target}.${observation.operation}EventListener(${observation.type})`;
  }
  if (observation.kind === "chrome-listener") {
    return `chrome.runtime.onMessage.${observation.operation}Listener()`;
  }
  if (observation.kind === "post-message") {
    return `window.postMessage(${String(observation.message?.type)})`;
  }
  return observation.label;
}

function describeObservations(observations) {
  const displayed = observations
    .slice(0, 30)
    .map((entry) => `  - ${formatObservation(entry)}`);
  const omitted = observations.length - displayed.length;
  if (omitted > 0) displayed.push(`  - ... ${omitted} more`);
  return displayed.join("\n");
}

function createInstrumentation(originalSetImmediate) {
  const observations = [];
  let armed = false;
  const listenerSets = {
    window: new Map(),
    document: new Map(),
    chrome: new Set(),
  };

  const record = (observation) => {
    if (armed) observations.push(observation);
  };
  const listenersFor = (target, type) => {
    let listeners = listenerSets[target].get(type);
    if (!listeners) {
      listeners = new Set();
      listenerSets[target].set(type, listeners);
    }
    return listeners;
  };
  const listenerMethod = (target, operation) => (type, callback) => {
    record({
      kind: "listener",
      target,
      operation,
      type: String(type),
      callback,
    });
    const listeners = listenersFor(target, String(type));
    if (operation === "add") listeners.add(callback);
    else listeners.delete(callback);
  };

  const proxyCache = new Map();
  const createRecursiveProxy = (label, overrides = new Map()) => {
    const cacheKey = `${label}:${overrides.size}`;
    const cached = proxyCache.get(cacheKey);
    if (cached) return cached;
    const target = function instrumentedValue() {};
    const proxy = new Proxy(target, {
      apply(_target, _thisArg, args) {
        record({ kind: "generic", label: `${label}():call(${args.length})` });
        return createRecursiveProxy(`${label}().result`);
      },
      construct(_target, args) {
        record({ kind: "generic", label: `new ${label}(${args.length})` });
        return createRecursiveProxy(`new ${label}().instance`);
      },
      defineProperty(_target, property) {
        record({
          kind: "generic",
          label: `${label}.${formatProperty(property)}:define`,
        });
        return true;
      },
      deleteProperty(_target, property) {
        record({
          kind: "generic",
          label: `${label}.${formatProperty(property)}:delete`,
        });
        return true;
      },
      get(_target, property) {
        if (property === Symbol.toPrimitive) return () => label;
        if (overrides.has(property)) return overrides.get(property);
        return createRecursiveProxy(`${label}.${formatProperty(property)}`);
      },
      set(_target, property) {
        record({
          kind: "generic",
          label: `${label}.${formatProperty(property)}:set`,
        });
        return true;
      },
    });
    proxyCache.set(cacheKey, proxy);
    return proxy;
  };

  const chromeOnMessage = {
    addListener(callback) {
      record({ kind: "chrome-listener", operation: "add", callback });
      listenerSets.chrome.add(callback);
    },
    removeListener(callback) {
      record({ kind: "chrome-listener", operation: "remove", callback });
      listenerSets.chrome.delete(callback);
    },
    hasListener(callback) {
      record({
        kind: "generic",
        label: "chrome.runtime.onMessage.hasListener()",
      });
      return listenerSets.chrome.has(callback);
    },
  };
  const runtimeOverrides = new Map([
    ["onMessage", chromeOnMessage],
    [
      "sendMessage",
      (...args) => {
        record({
          kind: "generic",
          label: `chrome.runtime.sendMessage(${args.length})`,
        });
        return Promise.resolve();
      },
    ],
  ]);
  const storageArea = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args) => {
          record({
            kind: "generic",
            label: `chrome.storage.local.${formatProperty(property)}(${args.length})`,
          });
          return Promise.resolve(property === "get" ? {} : undefined);
        };
      },
    }
  );
  const chromeOverrides = new Map([
    ["runtime", createRecursiveProxy("chrome.runtime", runtimeOverrides)],
    ["storage", { local: storageArea }],
  ]);

  const documentOverrides = new Map();
  const windowOverrides = new Map();
  const documentProxy = createRecursiveProxy("document", documentOverrides);
  const windowProxy = createRecursiveProxy("window", windowOverrides);
  const domMutation =
    (name, returnValue) =>
    (...args) => {
      record({ kind: "generic", label: `DOM.${name}(${args.length})` });
      return returnValue ?? createRecursiveProxy(`DOM.${name}.result`);
    };
  const domNode = createRecursiveProxy(
    "DOM.node",
    new Map([
      ["append", domMutation("append")],
      ["appendChild", domMutation("appendChild")],
      ["insertBefore", domMutation("insertBefore")],
      ["remove", domMutation("remove")],
      ["removeChild", domMutation("removeChild")],
      ["replaceChildren", domMutation("replaceChildren")],
      ["setAttribute", domMutation("setAttribute")],
    ])
  );
  documentOverrides.set("defaultView", windowProxy);
  documentOverrides.set("addEventListener", listenerMethod("document", "add"));
  documentOverrides.set(
    "removeEventListener",
    listenerMethod("document", "remove")
  );
  documentOverrides.set("createElement", domMutation("createElement", domNode));
  documentOverrides.set(
    "createElementNS",
    domMutation("createElementNS", domNode)
  );
  documentOverrides.set(
    "createTextNode",
    domMutation("createTextNode", domNode)
  );
  documentOverrides.set("body", domNode);
  documentOverrides.set("documentElement", domNode);
  windowOverrides.set("window", windowProxy);
  windowOverrides.set("self", windowProxy);
  windowOverrides.set("top", windowProxy);
  windowOverrides.set("parent", windowProxy);
  windowOverrides.set("document", documentProxy);
  windowOverrides.set("location", {
    href: "https://smoke.invalid/",
    origin: "https://smoke.invalid",
  });
  windowOverrides.set("__KNOWW_BRIDGE_NONCE__", smokeBridgeNonce);
  windowOverrides.set("addEventListener", listenerMethod("window", "add"));
  windowOverrides.set(
    "removeEventListener",
    listenerMethod("window", "remove")
  );
  windowOverrides.set("postMessage", (message, targetOrigin) => {
    record({ kind: "post-message", message, targetOrigin });
  });

  class InstrumentedEventTarget {
    addEventListener(type, callback) {
      record({
        kind: "listener",
        target: "EventTarget",
        operation: "add",
        type: String(type),
        callback,
      });
    }
    removeEventListener(type, callback) {
      record({
        kind: "listener",
        target: "EventTarget",
        operation: "remove",
        type: String(type),
        callback,
      });
    }
    dispatchEvent() {
      record({ kind: "generic", label: "EventTarget.dispatchEvent()" });
      return true;
    }
  }
  const observerClass = (name) =>
    class InstrumentedObserver {
      constructor() {
        record({ kind: "generic", label: `new ${name}()` });
      }
      observe() {
        record({ kind: "generic", label: `${name}.observe()` });
      }
      unobserve() {
        record({ kind: "generic", label: `${name}.unobserve()` });
      }
      disconnect() {
        record({ kind: "generic", label: `${name}.disconnect()` });
      }
      takeRecords() {
        record({ kind: "generic", label: `${name}.takeRecords()` });
        return [];
      }
    };
  const instrumentedCall =
    (name, returnValue) =>
    (...args) => {
      record({ kind: "generic", label: `${name}(${args.length})` });
      return returnValue;
    };
  const setGlobal = (name, value) => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value,
    });
  };

  setGlobal("chrome", createRecursiveProxy("chrome", chromeOverrides));
  setGlobal("window", windowProxy);
  setGlobal("self", windowProxy);
  setGlobal("document", documentProxy);
  setGlobal("navigator", createRecursiveProxy("navigator"));
  setGlobal("location", windowOverrides.get("location"));
  setGlobal("localStorage", createRecursiveProxy("localStorage"));
  setGlobal("sessionStorage", createRecursiveProxy("sessionStorage"));
  setGlobal("EventTarget", InstrumentedEventTarget);
  setGlobal("Node", createRecursiveProxy("Node"));
  setGlobal("Element", createRecursiveProxy("Element"));
  setGlobal("HTMLElement", createRecursiveProxy("HTMLElement"));
  setGlobal("Document", createRecursiveProxy("Document"));
  setGlobal("MutationObserver", observerClass("MutationObserver"));
  setGlobal("ResizeObserver", observerClass("ResizeObserver"));
  setGlobal("IntersectionObserver", observerClass("IntersectionObserver"));
  setGlobal("addEventListener", listenerMethod("window", "add"));
  setGlobal("removeEventListener", listenerMethod("window", "remove"));
  setGlobal("dispatchEvent", instrumentedCall("dispatchEvent", true));
  setGlobal("setTimeout", instrumentedCall("setTimeout", 1));
  setGlobal("clearTimeout", instrumentedCall("clearTimeout"));
  setGlobal("setInterval", instrumentedCall("setInterval", 1));
  setGlobal("clearInterval", instrumentedCall("clearInterval"));
  setGlobal("setImmediate", instrumentedCall("setImmediate", 1));
  setGlobal("clearImmediate", instrumentedCall("clearImmediate"));
  setGlobal("queueMicrotask", instrumentedCall("queueMicrotask"));
  setGlobal(
    "requestAnimationFrame",
    instrumentedCall("requestAnimationFrame", 1)
  );
  setGlobal("cancelAnimationFrame", instrumentedCall("cancelAnimationFrame"));
  setGlobal("requestIdleCallback", instrumentedCall("requestIdleCallback", 1));
  setGlobal("cancelIdleCallback", instrumentedCall("cancelIdleCallback"));
  setGlobal("getComputedStyle", instrumentedCall("getComputedStyle"));
  setGlobal("matchMedia", instrumentedCall("matchMedia"));
  setGlobal("fetch", instrumentedCall("fetch", Promise.resolve()));
  setGlobal("WebSocket", createRecursiveProxy("WebSocket"));
  setGlobal("XMLHttpRequest", createRecursiveProxy("XMLHttpRequest"));

  return {
    observations,
    listenerSets,
    arm() {
      armed = true;
    },
    clear() {
      observations.length = 0;
    },
    async drainMicrotasks() {
      await new Promise(originalSetImmediate);
      await new Promise(originalSetImmediate);
    },
  };
}

function assertNoObservations(observations, label) {
  if (observations.length === 0) return;
  throw new Error(
    `${label} side effects detected:\n${describeObservations(observations)}`
  );
}

function assertTradingFactoryInstall(observations, listenerSets) {
  const windowAdds = observations.filter(
    (entry) =>
      entry.kind === "listener" &&
      entry.target === "window" &&
      entry.operation === "add" &&
      entry.type === "message"
  );
  const chromeAdds = observations.filter(
    (entry) => entry.kind === "chrome-listener" && entry.operation === "add"
  );
  const walletPosts = observations.filter(
    (entry) =>
      entry.kind === "post-message" &&
      entry.message?.type === "KNOWW_LIST_WALLETS" &&
      entry.targetOrigin === "https://smoke.invalid"
  );
  if (
    observations.length !== 3 ||
    windowAdds.length !== 1 ||
    chromeAdds.length !== 1 ||
    walletPosts.length !== 1 ||
    listenerSets.window.get("message")?.size !== 1 ||
    listenerSets.chrome.size !== 1
  ) {
    throw new Error(
      `Trading runtime factory lifecycle mismatch (expected one bridge window listener, one service runtime listener, and one wallet discovery post; no signing listener or other work):\n${describeObservations(observations)}`
    );
  }
  return {
    windowCallback: windowAdds[0].callback,
    chromeCallback: chromeAdds[0].callback,
  };
}

function installFunctionArrayTracker() {
  const nativePush = Array.prototype.push;
  const nativeFilter = Array.prototype.filter;
  const additions = [];
  const removals = [];
  let phase = "idle";

  Array.prototype.push = function trackedPush(...items) {
    const beforeLength = this.length;
    const result = nativePush.apply(this, items);
    if (
      phase === "install" &&
      items.length === 1 &&
      typeof items[0] === "function"
    ) {
      nativePush.call(additions, {
        array: this,
        callback: items[0],
        beforeLength,
        afterLength: this.length,
      });
    }
    return result;
  };
  Array.prototype.filter = function trackedFilter(callback, thisArg) {
    const before = [...this];
    const result = nativeFilter.call(this, callback, thisArg);
    if (
      phase === "dispose" &&
      additions.some((addition) => addition.array === this)
    ) {
      nativePush.call(removals, {
        array: this,
        before,
        result,
      });
    }
    return result;
  };

  return {
    additions,
    removals,
    beginInstall() {
      phase = "install";
    },
    beginDispose() {
      phase = "dispose";
    },
    idle() {
      phase = "idle";
    },
    restore() {
      Array.prototype.push = nativePush;
      Array.prototype.filter = nativeFilter;
    },
  };
}

function assertTradingAccountSubscriptionInstall(tracker) {
  if (
    tracker.additions.length !== 1 ||
    tracker.additions[0].beforeLength !== 0 ||
    tracker.additions[0].afterLength !== 1
  ) {
    throw new Error(
      `Trading account subscription install mismatch (expected exactly one function subscription, got ${tracker.additions.length})`
    );
  }
  return tracker.additions[0];
}

function assertTradingAccountSubscriptionDispose(tracker, installed) {
  const removal = tracker.removals[0];
  if (
    tracker.removals.length !== 1 ||
    removal.array !== installed.array ||
    removal.before.length !== 1 ||
    removal.before[0] !== installed.callback ||
    removal.result.includes(installed.callback) ||
    removal.result.length !== 0
  ) {
    throw new Error(
      `Trading account subscription disposal mismatch (expected the exact installed callback filtered once, got ${tracker.removals.length} cleanup operations)`
    );
  }
}

async function assertInstalledListenerRoles(
  installed,
  accountSubscription,
  instrumentation
) {
  instrumentation.clear();
  let signingResponses = 0;
  const serviceResult = installed.chromeCallback(
    { type: "trading:signing-request", id: "smoke-signing-role" },
    {},
    () => {
      signingResponses += 1;
    }
  );
  await instrumentation.drainMicrotasks();
  if (
    serviceResult !== false ||
    signingResponses !== 0 ||
    instrumentation.observations.length !== 0
  ) {
    throw new Error(
      `Trading runtime listener role mismatch (the sole chrome listener behaved like a signing listener):\n${describeObservations(instrumentation.observations)}`
    );
  }

  let accountNotifications = 0;
  const originalAccountCallback = accountSubscription.callback;
  accountSubscription.array[0] = (...args) => {
    accountNotifications += 1;
    return originalAccountCallback(...args);
  };
  try {
    installed.windowCallback({
      source: globalThis.window,
      data: {
        type: "KNOWW_WALLET_ACCOUNTS_CHANGED",
        accounts: [],
        _n: smokeBridgeNonce,
      },
    });
    await instrumentation.drainMicrotasks();
  } finally {
    accountSubscription.array[0] = originalAccountCallback;
  }
  if (accountNotifications !== 1 || instrumentation.observations.length !== 0) {
    throw new Error(
      `Trading account subscription dispatch mismatch (expected one bridge-to-service notification, got ${accountNotifications}):\n${describeObservations(instrumentation.observations)}`
    );
  }
}

function assertTradingFactoryDispose(observations, listenerSets, installed) {
  const windowRemoves = observations.filter(
    (entry) =>
      entry.kind === "listener" &&
      entry.target === "window" &&
      entry.operation === "remove" &&
      entry.type === "message"
  );
  const chromeRemoves = observations.filter(
    (entry) => entry.kind === "chrome-listener" && entry.operation === "remove"
  );
  if (
    observations.length !== 2 ||
    windowRemoves.length !== 1 ||
    chromeRemoves.length !== 1 ||
    windowRemoves[0].callback !== installed.windowCallback ||
    chromeRemoves[0].callback !== installed.chromeCallback ||
    (listenerSets.window.get("message")?.size ?? 0) !== 0 ||
    listenerSets.chrome.size !== 0
  ) {
    throw new Error(
      `Trading runtime disposal lifecycle mismatch (expected the exact installed callbacks removed once and no listeners remaining):\n${describeObservations(observations)}`
    );
  }
}

async function runChild(mode, modulePath, expectedName) {
  if (mode !== "adapter" && mode !== "trading") {
    throw new Error(`Unknown child smoke mode: ${String(mode)}`);
  }
  if (!modulePath || !path.isAbsolute(modulePath)) {
    throw new Error("Child module path must be absolute");
  }
  if (mode === "adapter" && !expectedName) {
    throw new Error("Child expected adapter name is required");
  }

  const originalSetImmediate = globalThis.setImmediate.bind(globalThis);
  const instrumentation = createInstrumentation(originalSetImmediate);
  instrumentation.arm();
  const namespace = await import(pathToFileURL(modulePath).href);
  await instrumentation.drainMicrotasks();
  assertNoObservations(instrumentation.observations, "Import-time");

  if (mode === "adapter") {
    if (!("adapter" in namespace)) {
      throw new Error(`Module does not export adapter: ${modulePath}`);
    }
    if (namespace.adapter?.name !== expectedName) {
      throw new Error(
        `Adapter name mismatch for ${modulePath}: expected ${expectedName}, received ${String(namespace.adapter?.name)}`
      );
    }
    process.stdout.write(childSuccessOutput);
    return;
  }

  const namespaceNames = Object.keys(namespace).sort();
  if (
    namespaceNames.length !== 1 ||
    namespaceNames[0] !== "createTradingRuntime" ||
    typeof namespace.createTradingRuntime !== "function"
  ) {
    throw new Error(
      `Trading runtime namespace must be exactly ["createTradingRuntime"]: received ${JSON.stringify(namespaceNames)}`
    );
  }

  instrumentation.clear();
  const functionArrayTracker = installFunctionArrayTracker();
  try {
    functionArrayTracker.beginInstall();
    const first = namespace.createTradingRuntime();
    const second = namespace.createTradingRuntime();
    functionArrayTracker.idle();
    if (first !== second) {
      throw new Error(
        "Trading runtime factory did not return a strict singleton"
      );
    }
    if (!first || typeof first.dispose !== "function") {
      throw new Error("Trading runtime factory returned no disposable runtime");
    }
    await instrumentation.drainMicrotasks();
    const installed = assertTradingFactoryInstall(
      instrumentation.observations,
      instrumentation.listenerSets
    );
    const accountSubscription =
      assertTradingAccountSubscriptionInstall(functionArrayTracker);
    await assertInstalledListenerRoles(
      installed,
      accountSubscription,
      instrumentation
    );

    instrumentation.clear();
    functionArrayTracker.beginDispose();
    first.dispose();
    first.dispose();
    functionArrayTracker.idle();
    await instrumentation.drainMicrotasks();
    assertTradingFactoryDispose(
      instrumentation.observations,
      instrumentation.listenerSets,
      installed
    );
    assertTradingAccountSubscriptionDispose(
      functionArrayTracker,
      accountSubscription
    );
  } finally {
    functionArrayTracker.restore();
  }
  process.stdout.write(childSuccessOutput);
}

function assertRejectedControl(label, result, expectedStderr) {
  if (
    childProtocolError(result) === null ||
    result.code === 0 ||
    result.signal !== null ||
    result.timedOut ||
    !result.stderr.includes(expectedStderr) ||
    result.stdout.includes(childSuccessToken)
  ) {
    throw new Error(
      `${label} control was not rejected correctly: ${childProtocolError(result) ?? "child protocol unexpectedly passed"}`
    );
  }
}

async function runNegativeControls() {
  const directory = await mkdtemp(path.join(tmpdir(), "knoww-esm-smoke-"));
  try {
    const listenerPath = path.join(directory, "listener-side-effect.mjs");
    await writeFile(
      listenerPath,
      'globalThis.addEventListener("negative-control", () => {});\nexport const adapter = { name: "listener-side-effect" };\n',
      "utf8"
    );
    assertRejectedControl(
      "Listener side-effect",
      await runIsolatedImport("adapter", listenerPath, "listener-side-effect", {
        timeoutMs: controlTimeoutMs,
      }),
      "Import-time side effects detected"
    );

    const earlyExitPath = path.join(directory, "early-exit.mjs");
    await writeFile(
      earlyExitPath,
      'process.exit(0);\nexport const adapter = { name: "early-exit" };\n',
      "utf8"
    );
    const earlyExitResult = await runIsolatedImport(
      "adapter",
      earlyExitPath,
      "early-exit",
      { timeoutMs: controlTimeoutMs }
    );
    if (
      childProtocolError(earlyExitResult) === null ||
      earlyExitResult.code !== 0 ||
      earlyExitResult.signal !== null ||
      earlyExitResult.stderr !== "" ||
      earlyExitResult.stdout !== "" ||
      earlyExitResult.timedOut
    ) {
      throw new Error(
        `Early-exit control was not rejected for a missing handshake: ${childProtocolError(earlyExitResult) ?? "child protocol unexpectedly passed"}`
      );
    }

    const consoleOutputPath = path.join(directory, "console-output.mjs");
    await writeFile(
      consoleOutputPath,
      'console.log("unexpected-control-output");\nexport const adapter = { name: "console-output" };\n',
      "utf8"
    );
    const consoleOutputResult = await runIsolatedImport(
      "adapter",
      consoleOutputPath,
      "console-output",
      { timeoutMs: controlTimeoutMs }
    );
    if (
      childProtocolError(consoleOutputResult) === null ||
      consoleOutputResult.code !== 0 ||
      consoleOutputResult.signal !== null ||
      consoleOutputResult.stderr !== "" ||
      consoleOutputResult.stdout !==
        `unexpected-control-output\n${childSuccessOutput}` ||
      consoleOutputResult.timedOut
    ) {
      throw new Error(
        `Console-output control was not rejected for unexpected stdout: ${childProtocolError(consoleOutputResult) ?? "child protocol unexpectedly passed"}`
      );
    }

    const hangingPath = path.join(directory, "hanging-top-level-await.mjs");
    await writeFile(
      hangingPath,
      'import { setInterval as keepAlive } from "node:timers";\nexport const adapter = { name: "hanging-top-level-await" };\nawait new Promise(() => keepAlive(() => {}, 1_000));\n',
      "utf8"
    );
    const hangingResult = await runIsolatedImport(
      "adapter",
      hangingPath,
      "hanging-top-level-await",
      { timeoutMs: controlTimeoutMs }
    );
    if (
      childProtocolError(hangingResult) === null ||
      !hangingResult.timedOut ||
      hangingResult.signal !== "SIGKILL"
    ) {
      throw new Error(
        `Hanging top-level-await control was not timed out and killed: ${childProtocolError(hangingResult) ?? "child protocol unexpectedly passed"}`
      );
    }

    const duplicateInstallPath = path.join(directory, "duplicate-install.mjs");
    await writeFile(
      duplicateInstallPath,
      `let active; let accounts = [];\nexport function createTradingRuntime() {\n  if (active) return active;\n  const account = () => {}; const service = () => false;\n  const bridge = (event) => { if (event?.data?.type === "KNOWW_WALLET_ACCOUNTS_CHANGED") for (const listener of accounts) listener(event.data.accounts); };\n  const duplicate = () => {}; accounts.push(account);\n  window.addEventListener("message", bridge); window.addEventListener("message", duplicate);\n  chrome.runtime.onMessage.addListener(service);\n  window.postMessage({ type: "KNOWW_LIST_WALLETS" }, window.location.origin);\n  active = { dispose() { accounts = accounts.filter((listener) => listener !== account); window.removeEventListener("message", bridge); window.removeEventListener("message", duplicate); chrome.runtime.onMessage.removeListener(service); } };\n  return active;\n}\n`,
      "utf8"
    );
    assertRejectedControl(
      "Duplicate install",
      await runIsolatedImport("trading", duplicateInstallPath, "", {
        timeoutMs: controlTimeoutMs,
      }),
      "Trading runtime factory lifecycle mismatch"
    );

    const missingRemovalPath = path.join(directory, "missing-removal.mjs");
    await writeFile(
      missingRemovalPath,
      `let active; let accounts = [];\nexport function createTradingRuntime() {\n  if (active) return active;\n  const account = () => {}; const service = () => false;\n  const bridge = (event) => { if (event?.data?.type === "KNOWW_WALLET_ACCOUNTS_CHANGED") for (const listener of accounts) listener(event.data.accounts); };\n  accounts.push(account); window.addEventListener("message", bridge); chrome.runtime.onMessage.addListener(service);\n  window.postMessage({ type: "KNOWW_LIST_WALLETS" }, window.location.origin);\n  active = { dispose() { accounts = accounts.filter((listener) => listener !== account); window.removeEventListener("message", bridge); } };\n  return active;\n}\n`,
      "utf8"
    );
    assertRejectedControl(
      "Missing removal",
      await runIsolatedImport("trading", missingRemovalPath, "", {
        timeoutMs: controlTimeoutMs,
      }),
      "Trading runtime disposal lifecycle mismatch"
    );

    const missingAccountSubscriptionPath = path.join(
      directory,
      "missing-account-subscription.mjs"
    );
    await writeFile(
      missingAccountSubscriptionPath,
      `let active;\nexport function createTradingRuntime() {\n  if (active) return active;\n  const bridge = () => {}; const service = () => false;\n  window.addEventListener("message", bridge); chrome.runtime.onMessage.addListener(service);\n  window.postMessage({ type: "KNOWW_LIST_WALLETS" }, window.location.origin);\n  active = { dispose() { window.removeEventListener("message", bridge); chrome.runtime.onMessage.removeListener(service); } };\n  return active;\n}\n`,
      "utf8"
    );
    assertRejectedControl(
      "Missing account subscription",
      await runIsolatedImport("trading", missingAccountSubscriptionPath, "", {
        timeoutMs: controlTimeoutMs,
      }),
      "Trading account subscription install mismatch"
    );

    const missingAccountCleanupPath = path.join(
      directory,
      "missing-account-cleanup.mjs"
    );
    await writeFile(
      missingAccountCleanupPath,
      `let active; let accounts = [];\nexport function createTradingRuntime() {\n  if (active) return active;\n  let disposed = false; const account = () => {}; const service = () => false;\n  const bridge = (event) => { if (event?.data?.type === "KNOWW_WALLET_ACCOUNTS_CHANGED") for (const listener of accounts) listener(event.data.accounts); };\n  accounts.push(account); window.addEventListener("message", bridge); chrome.runtime.onMessage.addListener(service);\n  window.postMessage({ type: "KNOWW_LIST_WALLETS" }, window.location.origin);\n  active = { dispose() { if (disposed) return; disposed = true; window.removeEventListener("message", bridge); chrome.runtime.onMessage.removeListener(service); } };\n  return active;\n}\n`,
      "utf8"
    );
    assertRejectedControl(
      "Missing account cleanup",
      await runIsolatedImport("trading", missingAccountCleanupPath, "", {
        timeoutMs: controlTimeoutMs,
      }),
      "Trading account subscription disposal mismatch"
    );

    const malformedNamespacePath = path.join(
      directory,
      "malformed-namespace.mjs"
    );
    await writeFile(
      malformedNamespacePath,
      "export function createTradingRuntime() { return { dispose() {} }; }\nexport const unexpected = true;\n",
      "utf8"
    );
    assertRejectedControl(
      "Malformed namespace",
      await runIsolatedImport("trading", malformedNamespacePath, "", {
        timeoutMs: controlTimeoutMs,
      }),
      'Trading runtime namespace must be exactly ["createTradingRuntime"]'
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function runParent() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest)) {
    throw new Error(`Platform manifest must be an array: ${manifestPath}`);
  }
  await runNegativeControls();

  const failures = [];
  for (const entry of manifest) {
    if (!entry || typeof entry.name !== "string" || entry.name.length === 0) {
      failures.push(`Invalid manifest entry: ${JSON.stringify(entry)}`);
      continue;
    }
    const modulePath = path.resolve(
      extensionRoot,
      "dist",
      "platforms",
      `${entry.name}.js`
    );
    const result = await runIsolatedImport("adapter", modulePath, entry.name);
    const protocolError = childProtocolError(result);
    if (protocolError !== null)
      failures.push(`${entry.name}: ${protocolError}`);
  }

  const tradingPath = path.resolve(extensionRoot, "dist/content-trading.js");
  const tradingResult = await runIsolatedImport("trading", tradingPath);
  const tradingProtocolError = childProtocolError(tradingResult);
  if (tradingProtocolError !== null) {
    failures.push(`content-trading: ${tradingProtocolError}`);
  }

  if (failures.length > 0) {
    throw new Error(
      `ESM smoke failed for ${failures.length}/${manifest.length + 1} modules:\n\n${failures.join("\n\n")}`
    );
  }
  process.stdout.write(
    `ESM smoke passed: ${manifest.length} isolated platform modules + content-trading two-phase lifecycle; 9 controls rejected (4 protocol, 2 external lifecycle, 2 account-subscription lifecycle, 1 namespace).\n`
  );
}

try {
  if (process.argv[2] === "--child") {
    await runChild(process.argv[3], process.argv[4], process.argv[5]);
  } else {
    await runParent();
  }
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
