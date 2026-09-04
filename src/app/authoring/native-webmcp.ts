declare global {
  interface Window {
    __ardyNativeWebMcp?: boolean;
  }
}

/**
 * Whether this browser carried WebMCP itself. The polyfill installs `document.modelContext` when
 * the browser has none, and a hot-reloaded module evaluates after that, so the answer is taken
 * once per page and kept on the window.
 */
export const NATIVE_WEBMCP =
  typeof window === "undefined"
    ? false
    : (window.__ardyNativeWebMcp ??= document.modelContext !== undefined);
