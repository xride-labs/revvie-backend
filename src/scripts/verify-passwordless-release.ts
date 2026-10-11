import "dotenv/config";
import prisma from "../lib/prisma.js";

/**
 * Release gate for the passwordless migration. Exits non-zero unless
 *   1. no accounts.password hash remains, and
 *   2. (when API_BASE_URL is set) the retired endpoints refuse access.
 *
 * Usage: bun run src/scripts/verify-passwordless-release.ts
 *        API_BASE_URL=https://api.example.com bun run src/scripts/verify-passwordless-release.ts
 */
async function main() {
  let failed = false;

  const remaining = await prisma.account.count({ where: { password: { not: null } } });
  console.log(`accounts with a password hash: ${remaining}`);
  if (remaining !== 0) failed = true;

  const base = process.env.API_BASE_URL?.replace(/\/+$/, "");
  if (!base) {
    console.log("API_BASE_URL not set; skipping endpoint checks.");
  } else {
    const probes: Array<{ path: string; accept: (status: number) => boolean; label: string }> = [
      { path: "/api/account/change-password", accept: (s) => s === 410, label: "410 PASSWORD_AUTH_RETIRED" },
      { path: "/api/account/set-password", accept: (s) => s === 410, label: "410 PASSWORD_AUTH_RETIRED" },
      { path: "/api/auth/sign-in/email", accept: (s) => s >= 400, label: "rejected (4xx)" },
      { path: "/api/auth/sign-in/magic-link", accept: (s) => s >= 400, label: "rejected (4xx)" },
      { path: "/api/auth/request-password-reset", accept: (s) => s >= 400, label: "rejected (4xx)" },
    ];
    for (const probe of probes) {
      const response = await fetch(base + probe.path, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: "{}",
      });
      const ok = probe.accept(response.status);
      console.log(`${ok ? "ok  " : "FAIL"} ${probe.path} -> ${response.status} (expected ${probe.label})`);
      if (!ok) failed = true;
    }
  }

  await prisma.$disconnect();
  if (failed) {
    console.error("Passwordless release verification FAILED.");
    process.exit(1);
  }
  console.log("Passwordless release verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
