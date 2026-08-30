export interface MarketsPanelSearch {
  container: HTMLElement;
  inputWrapper: HTMLElement;
  input: HTMLInputElement;
  clearButton: HTMLButtonElement;
  results: HTMLElement;
}

export function createMarketsPanelSearch(): MarketsPanelSearch {
  const container = document.createElement("div");
  container.className = "knoww-search-container";
  container.id = "knoww-search-container";
  container.setAttribute("role", "search");

  const inputWrapper = document.createElement("div");
  inputWrapper.className = "knoww-search-input-wrapper";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "knoww-search-input";
  input.id = "knoww-search-input";
  input.placeholder = "Search Polymarket...";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search Polymarket markets");

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "knoww-search-clear";
  clearButton.id = "knoww-search-clear";
  clearButton.title = "Clear search";
  clearButton.setAttribute("aria-label", "Clear search");
  clearButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  `;
  clearButton.style.display = "none";

  const results = document.createElement("div");
  results.className = "knoww-search-results";
  results.id = "knoww-search-results";
  results.setAttribute("aria-live", "polite");

  inputWrapper.append(input, clearButton);
  container.append(inputWrapper, results);

  return { container, inputWrapper, input, clearButton, results };
}
