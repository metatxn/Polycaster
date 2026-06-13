import { domMax } from "framer-motion";

/**
 * Loaded asynchronously by <LazyMotion features={loadMotionFeatures}> so the
 * animation engine stays out of initial route bundles. domMax (not
 * domAnimation) because portfolio/tab-nav.tsx uses layout animations.
 */
export default domMax;
