import { z } from "zod";

const envSchema = z.object({
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXTAUTH_SECRET: z.string().min(1),
  JWT_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_NAME: z.string().default("WavesCo"),
  ENABLE_BILLING: z
    .string()
    .transform((v) => v !== "false")
    .default("false"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Lazy, memoized access to zod-validated environment variables. Parses
 * on first use so missing vars fail loudly at runtime, not at import.
 */
export function env(): Env {
  cached ??= envSchema.parse({ ...process.env });
  return cached;
}
