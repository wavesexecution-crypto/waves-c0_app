import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[a-z]/, "must contain a lowercase letter")
  .regex(/[A-Z]/, "must contain an uppercase letter")
  .regex(/[0-9]/, "must contain a digit");

export const tenantNameSchema = z.string().trim().min(2).max(80);

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case (letters, digits, hyphens)");

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
  tenantName: tenantNameSchema,
  tenantSlug: tenantSlugSchema.optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const tenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  plan: z.enum(["starter", "pro", "enterprise"]).default("starter"),
  status: z.enum(["active", "suspended"]).default("active"),
});

export type TenantData = z.infer<typeof tenantSchema>;

export const moduleEnableSchema = z.object({
  moduleName: z.string().min(1),
});

export type ModuleEnableInput = z.infer<typeof moduleEnableSchema>;

export const moduleDisableSchema = moduleEnableSchema;
export type ModuleDisableInput = z.infer<typeof moduleDisableSchema>;

export const tenantExportSchema = z.object({
  dataSchemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  tenant: tenantSchema,
  users: z.array(
    z.object({
      id: z.string().min(1),
      email: emailSchema,
      name: z.string().nullable(),
      role: z.string(),
    }),
  ),
  modules: z
    .array(
      z.object({
        moduleId: z.string(),
        status: z.string(),
        config: z.unknown().optional(),
      }),
    )
    .default([]),
  token: z.string().min(1).describe("signed one-time export token (24h expiry)"),
});

export type TenantExportBlob = z.infer<typeof tenantExportSchema>;
