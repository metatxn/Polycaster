import type {
  CardStyles,
  InjectionPoint,
  PlatformAdapter,
} from "../../types/platform";
import {
  buildDynamicSelectors,
  buildGenericCardStyles,
  collectTextParts,
  combineTextParts,
  detectGenericTheme,
  findInjectionAfterSelectors,
  findInjectionBeforeSelectors,
} from "./helpers";

export interface BasicAdapterConfig {
  name: string;
  hostPatterns: RegExp[];
  bypassEnglishCheck?: boolean;
  relaxContextGate?: boolean;
  maxInjectionsPerBatch?: number;
  maxActiveNotificationItems?: number;
  maxNotificationItems?: number;
  itemSelectors: string[];
  containerSelectors: string[];
  textSelectors: string[];
  contextSelectors?: string[];
  referenceSelectors?: string[];
  beforeSelectors?: string[];
  accentColor: string;
  fontFamily: string;
  borderRadius?: string;
  wrapperStyles?: string;
  getPostId?: (postElement: Element) => string | null;
  extractPostText?: (postElement: Element) => string;
  findInjectionPoint?: (postElement: Element) => InjectionPoint | null;
  detectTheme?: NonNullable<PlatformAdapter["detectTheme"]>;
  getCardStyles?: NonNullable<PlatformAdapter["getCardStyles"]>;
  getWrapperStyles?: NonNullable<PlatformAdapter["getWrapperStyles"]>;
  hasInjectedCard?: NonNullable<PlatformAdapter["hasInjectedCard"]>;
  getDynamicSelectors?: NonNullable<PlatformAdapter["getDynamicSelectors"]>;
  getCssClassPrefix?: NonNullable<PlatformAdapter["getCssClassPrefix"]>;
  findSidebarInjectionPoint?: NonNullable<
    PlatformAdapter["findSidebarInjectionPoint"]
  >;
}

function getRequiredSelectors(
  adapterName: string,
  selectorType: "item" | "container" | "text",
  selectors: string[]
): string[] {
  const validSelectors = selectors
    .map((selector) => selector.trim())
    .filter(Boolean);
  if (validSelectors.length === 0) {
    throw new Error(
      `Platform adapter "${adapterName}" requires at least one ${selectorType} selector`
    );
  }

  return validSelectors;
}

export function createBasicAdapter(
  config: BasicAdapterConfig
): PlatformAdapter {
  const itemSelectors = getRequiredSelectors(
    config.name,
    "item",
    config.itemSelectors
  );
  const containerSelectors = getRequiredSelectors(
    config.name,
    "container",
    config.containerSelectors
  );
  const textSelectors = getRequiredSelectors(
    config.name,
    "text",
    config.textSelectors
  );
  const itemSelector = itemSelectors.join(", ");
  const containerSelector = containerSelectors.join(", ");
  const textSelector = textSelectors.join(", ");

  const adapter: PlatformAdapter = {
    name: config.name,
    hostPatterns: config.hostPatterns,
    bypassEnglishCheck: config.bypassEnglishCheck,
    relaxContextGate: config.relaxContextGate,
    maxInjectionsPerBatch: config.maxInjectionsPerBatch,
    maxActiveNotificationItems: config.maxActiveNotificationItems,
    maxNotificationItems: config.maxNotificationItems,
    selectors: {
      item: itemSelector,
      container: containerSelector,
      text: textSelector,
    },
    extractPostText(postElement: Element): string {
      if (config.extractPostText) {
        return config.extractPostText(postElement);
      }

      const parts = [
        ...(config.contextSelectors
          ? collectTextParts(document, config.contextSelectors)
          : []),
        ...collectTextParts(postElement, textSelectors),
      ];

      return combineTextParts(parts);
    },
    findInjectionPoint(postElement: Element): InjectionPoint | null {
      if (config.findInjectionPoint) {
        return config.findInjectionPoint(postElement);
      }

      if (config.beforeSelectors?.length) {
        return findInjectionBeforeSelectors(
          postElement,
          config.beforeSelectors
        );
      }

      return findInjectionAfterSelectors(
        postElement,
        config.referenceSelectors || textSelectors
      );
    },
    detectTheme(): "dark" | "light" {
      if (config.detectTheme) {
        return config.detectTheme() as "dark" | "light";
      }

      return detectGenericTheme();
    },
    getCardStyles(theme?: string): CardStyles {
      if (config.getCardStyles) {
        return config.getCardStyles(theme) as CardStyles;
      }

      const activeTheme = (theme || detectGenericTheme()) as "dark" | "light";
      return buildGenericCardStyles(
        {
          accentColor: config.accentColor,
          fontFamily: config.fontFamily,
          borderRadius: config.borderRadius || "12px",
        },
        activeTheme
      );
    },
    getDynamicSelectors(): { itemSelector: string; containerSelector: string } {
      if (config.getDynamicSelectors) {
        return config.getDynamicSelectors();
      }

      return buildDynamicSelectors(itemSelector, containerSelectors);
    },
    getWrapperStyles(): string {
      if (config.getWrapperStyles) {
        return config.getWrapperStyles();
      }

      return (
        config.wrapperStyles ||
        `
          padding: 12px 0 0 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        `
      );
    },
    hasInjectedCard(postElement: Element): boolean {
      if (config.hasInjectedCard) {
        return config.hasInjectedCard(postElement);
      }

      return !!postElement.querySelector(".knoww-market-card");
    },
    getPostId(postElement: Element): string | null {
      return config.getPostId?.(postElement) || null;
    },
  };

  if (config.getCssClassPrefix) {
    adapter.getCssClassPrefix = config.getCssClassPrefix;
  }

  if (config.findSidebarInjectionPoint) {
    adapter.findSidebarInjectionPoint = config.findSidebarInjectionPoint;
  }

  return adapter;
}
