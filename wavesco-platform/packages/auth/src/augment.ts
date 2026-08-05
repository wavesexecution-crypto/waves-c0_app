import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    tenantId: string;
    role: string;
  }

  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth" {
  interface JWT {
    id: string;
    tenantId: string;
    role: string;
  }
}

export {};
