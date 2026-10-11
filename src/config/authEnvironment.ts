type Env = Record<string, string | undefined>;

/**
 * Names of authentication settings that must be configured for the current
 * environment. Passkeys bind credentials to an RP ID and allowed origins, so a
 * wrong or defaulted value silently strands every enrolled passkey.
 * Development and test fall back to localhost and require nothing.
 */
export function validateAuthEnvironment(env: Env = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const required = ["BETTER_AUTH_SECRET", "PASSKEY_RP_ID", "PASSKEY_ORIGINS"];
  const missing = required.filter((name) => !env[name]?.trim());

  // Apple sign-in is optional, but a half-configured provider is a mistake.
  const apple = ["AUTH_APPLE_ID", "AUTH_APPLE_SECRET"];
  if (apple.some((name) => env[name]?.trim()) && !apple.every((name) => env[name]?.trim())) {
    missing.push(...apple.filter((name) => !env[name]?.trim()));
  }
  return missing;
}
