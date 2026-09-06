export function isOnboardingSuppressedPath(pathname: string | null): boolean {
  if (!pathname) return false;

  return (
    pathname === "/" ||
    pathname === "/extension/connect" ||
    pathname === "/agent" ||
    pathname.startsWith("/agent/") ||
    pathname === "/privacy" ||
    pathname.startsWith("/privacy/")
  );
}
