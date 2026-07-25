/** Webpack DefinePlugin (see webpack.config.cjs). */
declare const __DEV_MODE__: boolean;

/**
 * Webpack DefinePlugin (see webpack.config.cjs). `true` in the Chrome Web
 * Store–compliant build (STORE_BUILD=true), which strips all real-money
 * trading / on-chain money-movement capability so the shipped bundle only
 * surfaces markets and displays read-only portfolio data. See
 * docs/chrome-prediction-market-ban-assessment.md.
 */
declare const __STORE_BUILD__: boolean;
