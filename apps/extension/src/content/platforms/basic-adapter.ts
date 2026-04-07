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

export function createBasicAdapter(
  config: BasicAdapterConfig
): PlatformAdapter {
  const itemSelector = config.itemSelectors.join(", ");
  const containerSelector = config.containerSelectors.join(", ");
  const textSelector = config.textSelectors.join(", ");

  const adapter: PlatformAdapter = {
    name: config.name,
    hostPatterns: config.hostPatterns,
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
        ...collectTextParts(postElement, config.textSelectors),
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
        config.referenceSelectors || config.textSelectors
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

      return buildDynamicSelectors(itemSelector, config.containerSelectors);
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
