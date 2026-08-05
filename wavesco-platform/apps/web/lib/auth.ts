import "next-auth/jwt";
import NextAuth from "next-auth";
import { authConfig } from "@wavesco/auth";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
