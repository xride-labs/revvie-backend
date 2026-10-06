# Revvie — Multi-Tenant Subdomain Architecture

This document describes the multi-tenant, hostname/subdomain-based architecture of Revvie across the Web frontend (Next.js 16) and Backend API (Express + Prisma + Better Auth).

---

## 1. Architectural Overview & Surfaces

Revvie provides distinct application surfaces served through dedicated subdomains rather than deeply nested paths:

| Surface | Canonical Hostname | Staging Hostname | Primary Purpose |
| :--- | :--- | :--- | :--- |
| **Consumer Application** | `revvie.app` | `revvie.xride-labs.in` | Feed, rides, marketplace, public profiles, events |
| **Platform Administration** | `admin.revvie.app` | `admin.revvie.xride-labs.in` | Global user management, platform roles, system metrics |
| **Brand Portal** | `{brand-slug}.revvie.app` | `{brand-slug}.revvie.xride-labs.in` | Brand dashboard, products, campaigns, inventory, team |
| **Club Portal** | `{club-slug}.revvie.app` | `{club-slug}.revvie.xride-labs.in` | Club dashboard, rides, member roster, club settings |

### Core Security Invariants
1. **Hostname establishes context, NEVER authorization:** The incoming subdomain/hostname determines the tenant context (`organizationId`, `slug`, `type`). It never confers permissions by itself.
2. **Session establishes identity:** Better Auth session cookie (`.session_token`) identifies the authenticated user (`userId`).
3. **Membership + RBAC establishes authorization:** A user is authorized to perform actions within an organization only if they hold an active membership (`OrganizationMembership`) and their role grants the required permission code.
4. **Zero-infrastructure tenant provisioning:** Creating a new club or brand portal requires **no DNS configuration**, **no deployment**, and **no server restart**. The database entry and wildcard routing handle resolution immediately.

---

## 2. Cloudflare Wildcard DNS Setup

Revvie utilizes Cloudflare for DNS, DDoS protection, and wildcard SSL termination.

### DNS Records

In your Cloudflare DNS dashboard for `revvie.app` (and `revvie.xride-labs.in`):

```text
Type   Name   Target                       Proxy Status   TTL
─────────────────────────────────────────────────────────────
A      @      <ingress-load-balancer-ip>   Proxied        Auto
CNAME  *      revvie.app                   Proxied        Auto
```

- **Apex Domain (`@`):** Points to the primary Next.js web application ingress.
- **Wildcard (`*`):** CNAME alias pointing to `revvie.app` with Cloudflare Proxy enabled (**Orange Cloud**).
- **SSL/TLS:** Set to **Full (Strict)**. Cloudflare automatically issues an Edge Certificate covering `revvie.app` and `*.revvie.app`.
- **Custom Domains (Optional Enterprise):** Cloudflare for SaaS (SSL for SaaS) can be used if enterprise brands map their own custom apex domain (e.g., `portal.ktm.com` -> `cname.revvie.app`).

---

## 3. Request Flow & Routing

```text
Incoming Request (e.g. ktm-bangalore.revvie.app/dashboard)
  │
  ├─► Cloudflare Wildcard DNS (*.revvie.app)
  │
  ├─► Next.js 16 Web Proxy (web/proxy.ts)
  │     │
  │     ├─► resolveHostname(host) -> category: TENANT, subdomain: "ktm-bangalore"
  │     ├─► GET /api/tenant/resolve?slug=ktm-bangalore (cached in memory)
  │     │     ├─ If not found -> rewrite to /tenant-not-found
  │     │     ├─ If suspended/archived -> rewrite to /tenant-suspended
  │     │     └─ If active -> inject x-tenant-* headers
  │     └─► Internal Path Rewrite:
  │           /dashboard  ->  /clubs/[id]
  │           /manage     ->  /clubs/[id]/manage
  │
  ├─► React Tree (Client & Server)
  │     ├─► Server: getTenantContext() reads x-tenant-* headers
  │     └─► Client: TenantProvider -> useTenantContext()
  │           ├─ ClubProvider automatically locks activeClubId to tenant.clubId
  │           └─ BusinessProvider automatically locks activeBusinessId to tenant.businessId
  │
  └─► Backend API (backend/src/server.ts)
        │
        ├─► Dynamic CORS: allows *.revvie.app and *.revvie.xride-labs.in
        ├─► tenantMiddleware: resolves tenant context and attaches req.tenant
        ├─► requireTenantAccess: verifies user is active member in OrganizationMembership
        ├─► requireTenantPermission: verifies membership role holds required permission
        └─► verifyTenantOwnership: prevents IDOR cross-tenant access
```

---

## 4. Multi-Tenant Database Schema

The architecture is backed by PostgreSQL via Prisma (`backend/prisma/schema.prisma`):

### Core Models
- **`Organization`**:
  - `id`: Unique identifier
  - `name`: Display name
  - `slug`: Unique URL-friendly slug (e.g., `ktm-bangalore`)
  - `type`: `PLATFORM` | `BRAND` | `CLUB` | `BUSINESS`
  - `status`: `ACTIVE` | `SUSPENDED` | `PENDING_REVIEW` | `ARCHIVED`
  - Relations: `domains`, `memberships`, `roles`, `club`, `businessProfile`
- **`OrganizationDomain`**:
  - `domain`: Fully qualified hostname (e.g., `ktm-bangalore.revvie.app`)
  - `isPrimary`: Boolean
  - `verified`: Boolean
- **`OrganizationMembership`**:
  - `userId` + `organizationId` (unique compound key)
  - `roleId`: Points to an organization-scoped `Role`
  - `status`: `ACTIVE` | `SUSPENDED` | `INVITED` | `ARCHIVED`
- **`Role`**:
  - `scope`: `ORGANIZATION` | `GLOBAL`
  - `organizationId`: Optional relation to `Organization`
  - `organizationType`: Scoped to `OrganizationType`
  - `permissions`: String array of permission codes

### Organization-Scoped RBAC Boundaries
Organizations can define custom roles, but permissions are strictly enforced by `RolesService.validateRolePermissionsForOrgType`:
- **`CLUB` organizations:** Can only assign `club:*` permissions. Attempting to assign `system:*` or `business:*` throws a validation error.
- **`BRAND` / `BUSINESS` organizations:** Can only assign `business:*` permissions.
- **`PLATFORM` organization:** Can assign `system:*` and platform administrative permissions.

---

## 5. Reserved Subdomains

Reserved subdomains are strictly prevented from being registered as organization slugs:

```ts
export const RESERVED_SUBDOMAINS = [
  'admin',     // Reserved for Platform administration
  'api',       // Reserved for API gateway
  'app',       // Reserved for Consumer application
  'assets',    // Reserved for Static assets
  'auth',      // Reserved for Better Auth endpoints
  'billing',   // Reserved for Financial services
  'cdn',       // Reserved for Content delivery network
  'dev',       // Reserved for Developer environments
  'docs',      // Reserved for Documentation
  'mail',      // Reserved for Email infrastructure
  'preview',   // Reserved for Preview deployments
  'staging',   // Reserved for Staging root
  'static',    // Reserved for Static assets
  'status',    // Reserved for System health status
  'support',   // Reserved for Helpdesk
  'test',      // Reserved for Test suites
  'www',       // Reserved for Apex domain redirect
] as const;
```

---

## 6. Local Development Workflow

Modern web browsers (Chrome, Firefox, Safari, Edge) treat all domains ending in `.localhost` as loopback addresses resolving to `127.0.0.1` without modifying `/etc/hosts` or `C:\Windows\System32\drivers\etc\hosts`.

### Running with Subdomains Locally

1. **Start the Web Dev Server:**
   ```bash
   cd web
   pnpm dev
   ```
   Server listens on `localhost:3000`.

2. **Access Portals Directly:**
   - **Consumer App:** `http://localhost:3000`
   - **Platform Admin:** `http://admin.localhost:3000`
   - **Club Tenant:** `http://ktm-bangalore.localhost:3000`
   - **Brand Tenant:** `http://ktm.localhost:3000`

3. **Query Fallback (Development Helper):**
   For rapid testing or environments where `.localhost` subdomains cannot be used:
   - `http://localhost:3000/?__tenant=ktm-bangalore`

---

## 7. Environment Configuration Reference

### Web (`web/.env`)
```ini
# Root domain for subdomain extraction (auto-detects if not specified)
# Staging: revvie.xride-labs.in
# Production: revvie.app
NEXT_PUBLIC_ROOT_DOMAIN=revvie.xride-labs.in

# Backend API URL
NEXT_PUBLIC_API_URL=https://api.revvie.xride-labs.in/api
INTERNAL_API_URL=http://localhost:5000/api
```

### Backend (`backend/.env`)
```ini
# Root domain for tenant resolution
ROOT_DOMAIN=revvie.xride-labs.in

# Better Auth Cross-Subdomain Cookie Domain
# Enables single sign-on across all subdomains
BETTER_AUTH_COOKIE_DOMAIN=.xride-labs.in
```
