export function isOnboardingSuppressedPath(pathname: string | null): boolean {
  if (!pathname) return false;

  return (
    pathname === "/" ||
    pathname === "/agent" ||
    pathname.startsWith("/agent/") ||
    pathname === "/privacy" ||
    pathname.startsWith("/privacy/")
  );
}
