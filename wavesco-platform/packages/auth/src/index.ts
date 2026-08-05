import "./augment";

export { authConfig } from "./config";
export {
  signAccessToken,
  verifyAccessToken,
  rotateRefreshToken,
  revokeRefreshToken,
  hashToken,
  parseDuration,
} from "./jwt";
export type { AccessTokenClaims, VerifiedAccessToken, RefreshTokenResult } from "./jwt";
export { hashPassword, verifyPassword } from "./password";
export {
  requireSession,
  requireRole,
  getTenantId,
  UnauthorizedError,
  ForbiddenError,
} from "./session";
export type { SessionUser } from "./session";
export { emailAdapter } from "./verification";
