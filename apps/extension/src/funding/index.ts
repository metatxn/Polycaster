// apps/extension/src/funding/index.ts
// Public surface of the funding module. Later tasks (surface adoption)
// import from here rather than reaching into machine.ts / types.ts /
// gateway.ts / controller.ts directly.

export * from "./controller";
export * from "./gateway";
export * from "./machine";
export * from "./types";
