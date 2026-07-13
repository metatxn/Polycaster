function moduleIdentifier(module) {
  for (const field of ["nameForCondition", "identifier", "name"]) {
    if (typeof module?.[field] === "string" && module[field].length > 0) {
      return module[field];
    }
  }
  return null;
}

function hasSelectedChunk(module, selectedChunks) {
  return module.chunks?.some((chunkId) => selectedChunks.has(String(chunkId)));
}

function collectModuleTree(module, selectedChunks, modules, inherited = false) {
  if (!module || typeof module !== "object") return;
  if (module.chunks !== undefined && !Array.isArray(module.chunks)) {
    throw new TypeError("Webpack stats module chunks must be an array");
  }
  if (module.modules !== undefined && !Array.isArray(module.modules)) {
    throw new TypeError("Webpack stats module nested modules must be an array");
  }

  const selected = inherited || hasSelectedChunk(module, selectedChunks);
  if (selected) {
    const identifier = moduleIdentifier(module);
    if (identifier) modules.add(identifier);
  }

  for (const nestedModule of module.modules ?? []) {
    collectModuleTree(nestedModule, selectedChunks, modules, selected);
  }
}

/**
 * Recursively collect the source-module identifiers associated with one
 * webpack entrypoint. Concatenated child modules inherit their selected
 * parent's chunk membership because webpack commonly omits child `chunks`.
 */
export function collectEntryModules(statsJson, entryName) {
  const entrypoint = statsJson?.entrypoints?.[entryName];
  if (!entrypoint) {
    throw new Error(`Missing entrypoint "${entryName}" in webpack stats`);
  }

  if (!Array.isArray(entrypoint.chunks) || entrypoint.chunks.length === 0) {
    throw new TypeError(
      `Entrypoint "${entryName}" chunks must be a non-empty array`
    );
  }
  if (!Array.isArray(statsJson.modules)) {
    throw new TypeError("Webpack stats modules must be an array");
  }
  if (!Array.isArray(statsJson.chunks)) {
    throw new TypeError("Webpack stats chunks must be an array");
  }

  const selectedChunks = new Set(
    entrypoint.chunks.map((chunkId) => String(chunkId))
  );
  const availableChunks = new Set(
    statsJson.chunks.map((chunk) => String(chunk?.id))
  );
  for (const chunkId of selectedChunks) {
    if (!availableChunks.has(chunkId)) {
      throw new Error(
        `Selected chunk "${chunkId}" is missing from webpack stats`
      );
    }
  }

  const modules = new Set();

  for (const module of statsJson.modules) {
    collectModuleTree(module, selectedChunks, modules);
  }

  for (const chunk of statsJson.chunks) {
    if (!selectedChunks.has(String(chunk?.id))) continue;
    if (chunk.modules !== undefined && !Array.isArray(chunk.modules)) {
      throw new TypeError(
        `Selected chunk "${String(chunk?.id)}" modules must be an array`
      );
    }
    for (const module of chunk.modules ?? []) {
      collectModuleTree(module, selectedChunks, modules, true);
    }
  }

  if (modules.size === 0) {
    throw new Error(`Entrypoint "${entryName}" module graph is empty`);
  }

  return modules;
}
