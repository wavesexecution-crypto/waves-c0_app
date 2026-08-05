import type { Adapter } from "next-auth/adapters";
import { prisma } from "@wavesco/db";

/**
 * Minimal Auth.js adapter for the Email (magic link) provider.
 *
 * Only the verification-token methods are implemented. The rest throw
 * loudly — WavesCo auth is tenant-scoped and deliberately does NOT use
 * Auth.js's generic Account/Session tables.
 */
function notImplemented(method: string): never {
  throw new Error(`Auth.js adapter method "${method}" is not implemented — WavesCo uses tenant-scoped auth.`);
}

export const emailAdapter: Adapter = {
  createUser: () => notImplemented("createUser"),
  getUser: () => notImplemented("getUser"),
  getUserByEmail: () => notImplemented("getUserByEmail"),
  getUserByAccount: () => notImplemented("getUserByAccount"),
  updateUser: () => notImplemented("updateUser"),
  deleteUser: () => notImplemented("deleteUser"),
  linkAccount: () => notImplemented("linkAccount"),
  unlinkAccount: () => notImplemented("unlinkAccount"),
  createSession: () => notImplemented("createSession"),
  getSessionAndUser: () => notImplemented("getSessionAndUser"),
  updateSession: () => notImplemented("updateSession"),
  deleteSession: () => notImplemented("deleteSession"),

  async createVerificationToken(verificationToken) {
    await prisma.verificationToken.create({
      data: {
        identifier: verificationToken.identifier,
        token: verificationToken.token,
        expires: verificationToken.expires,
      },
    });
    return verificationToken;
  },

  async useVerificationToken(params) {
    const existing = await prisma.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: params.identifier,
          token: params.token,
        },
      },
    });
    if (!existing) return null;
    await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: params.identifier,
          token: params.token,
        },
      },
    });
    return {
      identifier: existing.identifier,
      token: existing.token,
      expires: existing.expires,
    };
  },
};
