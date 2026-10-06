export const RESERVED_SUBDOMAINS = [
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "cdn",
  "dev",
  "docs",
  "mail",
  "preview",
  "staging",
  "static",
  "status",
  "support",
  "test",
  "www",
] as const;

export type ReservedSubdomain = (typeof RESERVED_SUBDOMAINS)[number];

export function isReservedSubdomain(subdomain: string): boolean {
  const normalized = (subdomain || "").toLowerCase().trim();
  return (RESERVED_SUBDOMAINS as readonly string[]).includes(normalized);
}
