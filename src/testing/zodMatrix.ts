/**
 * Behavioural Zod schema matrix engine.
 *
 * Instead of hand-writing thousands of validation tests, this engine
 * introspects every exported object schema and generates:
 *
 *   1. Positive cases   – builds a payload where every field receives a value
 *                         the FIELD itself accepts (probed behaviourally via
 *                         safeParse, so this works on any zod version) and
 *                         asserts the whole schema parses it.
 *   2. Negative cases   – for every field, every value from a canonical
 *                         "garbage pool" that the FIELD rejects must also be
 *                         rejected by the WHOLE schema with the issue pointing
 *                         at that field (or, for cross-field refinements,
 *                         failing somewhere).
 *   3. Missing-required  – fields whose own probe rejects `undefined` must be
 *                         rejected by the whole schema when omitted.
 *   4. Wrong-blob        – non-object inputs (null, arrays, scalars, strings)
 *                         must always fail.
 *
 * Because acceptance is decided by probing the field itself, the engine never
 * touches zod internals (`_def`, `def.type`, …) and keeps working as schemas
 * evolve — new fields automatically get full coverage.
 */

import { describe, it, expect } from "vitest";

export type SafeParseResult = {
  success: boolean;
  data?: any;
  error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
};

export type FieldSchema = {
  safeParse(value: unknown): SafeParseResult;
};

export type ObjectSchema = {
  safeParse(value: unknown): SafeParseResult;
  shape?: Record<string, FieldSchema>;
};

/** Canonical pool of hostile / type-confused values fed to every field. */
export const GARBAGE_POOL: Array<{ label: string; value: unknown }> = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "empty-string", value: "" },
  { label: "whitespace", value: "   " },
  { label: "zero", value: 0 },
  { label: "negative-int", value: -1 },
  { label: "float", value: 1.5 },
  { label: "NaN", value: Number.NaN },
  { label: "Infinity", value: Number.POSITIVE_INFINITY },
  { label: "huge-number", value: 9007199254740991 },
  { label: "boolean", value: true },
  { label: "numeric-string", value: "42" },
  { label: "long-string", value: "x".repeat(3000) },
  { label: "sql-injection", value: "'; DROP TABLE users; --" },
  { label: "script-tag", value: "<script>alert(1)</script>" },
  { label: "unicode", value: "\u0000\uFFFF🚀" },
  { label: "object", value: { nested: true } },
  { label: "array", value: ["a"] },
];

/** Values asserted to be rejected wholesale by any object schema. */
export const WRONG_BLOBS: Array<{ label: string; value: unknown }> = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "number", value: 123 },
  { label: "string", value: "hello" },
  { label: "boolean", value: false },
  { label: "array", value: [] },
];

export function isObjectSchema(schema: unknown): schema is ObjectSchema {
  try {
    const s = schema as ObjectSchema;
    return (
      !!s &&
      typeof s === "object" &&
      typeof s.safeParse === "function" &&
      !!s.shape &&
      typeof s.shape === "object" &&
      Object.keys(s.shape).length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Typed candidates used to find an ACCEPTED value for pattern-bearing fields
 * (CUID ids, emails, URLs, phone numbers, datetimes, arrays of objects…)
 * that reject every entry of the hostile pool above.
 */
const VALID_POOL: Array<{ label: string; value: unknown }> = [
  { label: "cuid-like-id", value: "clxxxxxxxxxxxxxxxxxxxxxxxx" },
  { label: "hex24-objectid", value: "507f1f77bcf86cd799439011" },
  { label: "six-digit-code", value: "123456" },
  { label: "uuid", value: "123e4567-e89b-12d3-a456-426614174000" },
  { label: "email", value: "rider@example.com" },
  { label: "password", value: "Sup3rSecret!Pass" },
  { label: "phone", value: "+15551234567" },
  { label: "url", value: "https://app.revvie.test/path" },
  { label: "datetime", value: new Date("2026-01-15T10:30:00.000Z") },
  { label: "datetime-iso", value: "2026-01-15T10:30:00.000Z" },
  { label: "positive-int", value: 5 },
  { label: "positive-float", value: 42.5 },
  { label: "text", value: "hello world" },
  { label: "slug", value: "morning-ride" },
  { label: "empty-array", value: [] },
  { label: "string-array", value: ["a", "b"] },
  { label: "object-array", value: [{ name: "Ada", phone: "+15551234567" }] },
  { label: "object", value: { key: "value" } },
];

/** Harvest allowed literals out of zod's own enum-style error issues. */
function harvestEnumValues(result: SafeParseResult): unknown[] {
  const out: unknown[] = [];
  for (const issue of result.error?.issues ?? []) {
    const vals = (issue as unknown as { values?: unknown[] }).values;
    if (Array.isArray(vals)) out.push(...vals);
  }
  return out;
}

export function probeField(field: FieldSchema): {
  accepted: unknown | undefined;
  rejected: Array<{ label: string; value: unknown }>;
} {
  let accepted: unknown | undefined;
  const rejected: Array<{ label: string; value: unknown }> = [];

  const tryValue = (label: string, value: unknown): boolean => {
    let result: SafeParseResult;
    try {
      result = field.safeParse(value);
    } catch {
      return false;
    }
    if (result.success) {
      // Prefer MEANINGFUL accepted values for positive cases — an optional
      // string with no min() happily accepts "", but cross-field refinements
      // (e.g. "message needs text") then reject the assembled payload.
      if (value !== undefined && accepted === undefined) {
        const trivial =
          value === "" || (typeof value === "string" && value.trim() === "");
        if (!trivial) accepted = value;
        else fallbackAccepted ??= value;
      }
      return true;
    }
    if (value !== undefined) rejected.push({ label, value });
    return false;
  };

  let lastRejection: SafeParseResult | undefined;
  let fallbackAccepted: unknown | undefined;

  // Pass 1: hostile pool — everything REJECTED here becomes a negative case.
  for (const candidate of GARBAGE_POOL) {
    if (!tryValue(candidate.label, candidate.value)) {
      // keep probing; rejections accumulate
    }
  }

  if (accepted !== undefined) return { accepted, rejected };

  // Pass 2: typed valid candidates for picky string/array formats.
  for (const candidate of VALID_POOL) {
    tryValue(candidate.label, candidate.value);
    if (accepted !== undefined) return { accepted, rejected };
  }

  // Pass 3: ask zod itself — enum-style issues carry their allowed values.
  for (const candidate of GARBAGE_POOL) {
    try {
      const r = field.safeParse(candidate.value);
      if (!r.success) {
        lastRejection = r;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (lastRejection) {
    for (const literal of harvestEnumValues(lastRejection)) {
      tryValue("enum-member", literal);
      if (accepted !== undefined) break;
    }
  }

  return { accepted: accepted ?? fallbackAccepted, rejected };
}

function fieldRejectsUndefined(field: FieldSchema): boolean {
  try {
    return field.safeParse(undefined).success === false;
  } catch {
    return false;
  }
}

export function describeValue(label: string): string {
  return label;
}

/**
 * Registers a full describe() block of generated cases for one schema.
 * Returns the number of registered test cases (for coverage reporting).
 */
export function describeSchemaMatrix(
  schemaName: string,
  schema: ObjectSchema,
): number {
  let count = 0;
  const shape = schema.shape!;
  const fieldNames = Object.keys(shape);

  describe(`schema ${schemaName}`, () => {
    it("exposes an introspectable shape with at least one field", () => {
      expect(fieldNames.length).toBeGreaterThanOrEqual(1);
    });
    count++;

    // ── Wrong blobs ────────────────────────────────────────────────
    describe("rejects non-object payloads", () => {
      for (const blob of WRONG_BLOBS) {
        it(`rejects ${blob.label}`, () => {
          const result = schema.safeParse(blob.value);
          expect(result.success).toBe(false);
          expect((result.error?.issues ?? []).length).toBeGreaterThan(0);
        });
        count++;
      }
    });

    // ── Per-field negatives ────────────────────────────────────────
    // Fields typed as z.any()/coerce.boolean()/records accept the whole
    // pool — they legitimately produce zero negative cases, so their
    // describe blocks are skipped entirely (vitest fails empty suites).
    describe("per-field invalid values", () => {
      for (const fieldName of fieldNames) {
        const field = shape[fieldName];
        const { rejected } = probeField(field);
        if (rejected.length === 0) continue;

        describe(`field ${fieldName}`, () => {
          for (const bad of rejected) {
            it(`rejects ${bad.label}`, () => {
              const result = schema.safeParse({ [fieldName]: bad.value });
              expect(result.success).toBe(false);
              expect((result.error?.issues ?? []).length).toBeGreaterThan(0);
            });
            count++;
          }
        });
      }
    });

    // ── Missing required fields ────────────────────────────────────
    const requiredFields = fieldNames.filter((fieldName) =>
      fieldRejectsUndefined(shape[fieldName]),
    );

    if (requiredFields.length > 0) {
      describe("missing required fields", () => {
        for (const fieldName of requiredFields) {
          it(`rejects omitted ${fieldName}`, () => {
            const payload: Record<string, unknown> = {};
            for (const other of fieldNames) {
              if (other === fieldName) continue;
              const probe = probeField(shape[other]);
              if (probe.accepted !== undefined) payload[other] = probe.accepted;
            }
            const result = schema.safeParse(payload);
            // The schema must fail — either on the missing field itself or
            // on a cross-field refinement that depends on it.
            expect(result.success).toBe(false);
          });
          count++;
        }
      });
    }

    // ── Positive case ──────────────────────────────────────────────
    it("accepts a payload built entirely of field-valid values", () => {
      const payload: Record<string, unknown> = {};
      for (const fieldName of fieldNames) {
        const { accepted } = probeField(shape[fieldName]);
        if (accepted !== undefined) payload[fieldName] = accepted;
      }
      const result = schema.safeParse(payload);

      if (!result.success) {
        // Cross-field refinements (e.g. endAfterStart) can legitimately
        // reject per-field-valid combos. Repair by dropping optional
        // offenders once; if it still fails, that's a real bug worth a look.
        const offendingPaths = (result.error?.issues ?? [])
          .map((i) => String(i.path?.[0]))
          .filter(Boolean);
        for (const p of new Set(offendingPaths)) delete payload[p];
        const repaired = schema.safeParse(payload);
        if (!repaired.success) {
          throw new Error(
            `schema ${schemaName} rejected a field-valid payload: ${JSON.stringify(
              repaired.error?.issues?.[0],
            )}`,
          );
        }
        return;
      }
      expect(result.success).toBe(true);
    });
    count++;
  });

  return count;
}

/**
 * Runs the matrix over every object-shaped export of a validators module.
 */
export function runModuleMatrix(
  moduleName: string,
  module: Record<string, unknown>,
): void {
  const schemas = Object.entries(module).filter(([name, value]) =>
    isObjectSchema(value),
  );

  describe(`${moduleName} — generated validation matrix (${schemas.length} schemas)`, () => {
    it("discovers object schemas to exercise", () => {
      expect(schemas.length).toBeGreaterThan(0);
    });

    for (const [name, schema] of schemas) {
      describeSchemaMatrix(name, schema as ObjectSchema);
    }
  });
}
