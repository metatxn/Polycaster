import type { InjectionPoint } from "../../types/platform";
import { registerAdapterWithRetry } from "../platform-registry";
import { createBasicAdapter } from "./basic-adapter";
import {
  collectTextParts,
  combineTextParts,
  findInjectionAfterSelectors,
  normalizeText,
} from "./helpers";

const HackerNewsAdapter = createBasicAdapter({
  name: "hackernews",
  hostPatterns: [/^news\.ycombinator\.com$/],
  itemSelectors: [".athing[id]", "tr.comtr"],
  containerSelectors: ["table.itemlist", ".comment-tree", "body"],
  textSelectors: [".titleline a", ".commtext", ".toptext"],
  accentColor: "#ff6600",
  fontFamily: "Verdana, Geneva, sans-serif",
  borderRadius: "8px",
  wrapperStyles: `
    padding: 8px 0 0 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  extractPostText(postElement: Element): string {
    if (postElement.matches("tr.comtr")) {
      return combineTextParts(collectTextParts(postElement, [".commtext"]));
    }

    const title = normalizeText(
      postElement.querySelector(".titleline a")?.textContent
    );
    const subtext = normalizeText(postElement.nextElementSibling?.textContent);
    return combineTextParts([title, subtext]);
  },
  findInjectionPoint(postElement: Element): InjectionPoint | null {
    if (postElement.matches(".athing[id]")) {
      const metaRow = postElement.nextElementSibling;
      if (metaRow?.parentElement) {
        const wrapperRow = document.createElement("tr");
        wrapperRow.className = "knoww-card-row";
        const cell = document.createElement("td");
        const colCount = postElement.querySelectorAll(":scope > td").length;
        cell.setAttribute("colspan", String(colCount || 3));
        cell.style.cssText = "padding: 0 0 8px 0;";
        wrapperRow.appendChild(cell);

        metaRow.parentElement.insertBefore(wrapperRow, metaRow.nextSibling);

        return {
          container: cell,
          insertPosition: "append",
          postWrapper: postElement,
        };
      }
    }

    if (postElement.matches("tr.comtr")) {
      const comment = postElement.querySelector(".comment");
      if (comment?.parentElement) {
        return {
          container: comment.parentElement,
          referenceElement: comment,
          insertPosition: "after",
          postWrapper: postElement,
        };
      }
    }

    return findInjectionAfterSelectors(postElement, [
      ".titleline a",
      ".commtext",
    ]);
  },
  hasInjectedCard(postElement: Element): boolean {
    if (postElement.matches(".athing[id]")) {
      const metaRow = postElement.nextElementSibling;
      const cardRow = metaRow?.nextElementSibling;
      if (cardRow?.classList.contains("knoww-card-row")) {
        return true;
      }
    }
    return !!postElement.querySelector(".knoww-market-card");
  },
  getPostId(postElement: Element): string | null {
    return postElement.getAttribute("id");
  },
});

registerAdapterWithRetry(HackerNewsAdapter, 100, 50);

export { HackerNewsAdapter };
