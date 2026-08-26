/**
 * Email verification — DNS MX lookup + optional SMTP probe.
 *
 * No external service required. Uses Node.js built-in `dns` and `net` modules.
 * Safe for production: timeouts, error handling, no secrets.
 */
import { resolveMx } from "node:dns";
import { connect } from "node:net";

export interface VerifyResult {
  valid: boolean;
  reason: string;
  mxFound: boolean;
  smtpAccepted: boolean;
}

const TIMEOUT_MS = 8_000;

/**
 * Verify an email address:
 *   1. Format check (basic RFC)
 *   2. DNS MX record lookup (does the domain accept mail?)
 *   3. Optional SMTP probe (does the mailbox exist?)
 *
 * SMTP probe is best-effort — many servers reject or rate-limit probes.
 * MX lookup alone is sufficient for most verification needs.
 */
export async function verifyEmail(email: string): Promise<VerifyResult> {
  const raw = email.trim().toLowerCase();

  // 1. Format check
  if (!raw || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(raw)) {
    return { valid: false, reason: "invalid email format", mxFound: false, smtpAccepted: false };
  }

  const domain = raw.split("@")[1] ?? "";

  // 2. MX lookup
  let mxFound = false;
  let mxHost = "";
  try {
    const records = await new Promise<{ priority: number; exchange: string }[]>((resolve, reject) => {
      resolveMx(domain, (err, addresses) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve(addresses);
      });
    });
    if (records.length > 0) {
      mxFound = true;
      records.sort((a, b) => a.priority - b.priority);
      mxHost = records[0]?.exchange ?? mxHost;
    }
  } catch {
    mxFound = false;
  }

  if (!mxFound) {
    return { valid: false, reason: `no MX records for domain ${domain}`, mxFound: false, smtpAccepted: false };
  }

  // 3. SMTP probe (best-effort)
  let smtpAccepted = false;
  try {
    smtpAccepted = await smtpProbe(mxHost, raw);
  } catch {
    // SMTP probe is best-effort — treat failure as "unknown", not "invalid"
    smtpAccepted = false;
  }

  // MX found + valid format = at minimum "likely valid"
  // SMTP accepted = definitely valid
  // SMTP rejected but MX exists = "risky" but we treat as valid for now
  // (many legitimate mailboxes reject probes)
  const valid = true;
  const reason = smtpAccepted
    ? `MX found (${mxHost}), SMTP accepted`
    : `MX found (${mxHost}), SMTP probe inconclusive`;

  return { valid, reason, mxFound, smtpAccepted };
}

/**
 * SMTP probe — connects to MX host, runs EHLO + RCPT TO.
 * Returns true if server responds 250 to RCPT TO (mailbox exists).
 */
function smtpProbe(mxHost: string, email: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(25, mxHost);
    let step = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, TIMEOUT_MS);

    socket.setEncoding("utf-8");

    socket.on("data", (data: string) => {

      if (step === 0 && data.startsWith("220")) {
        // Server greeting — send EHLO
        step = 1;
        socket.write(`EHLO wavesco.in\r\n`);
      } else if (step === 1 && (data.includes("250") || data.includes("252"))) {
        // EHLO accepted — send MAIL FROM
        step = 2;
        socket.write(`MAIL FROM:<verify@wavesco.in>\r\n`);
      } else if (step === 2 && (data.includes("250") || data.includes("252"))) {
        // MAIL FROM accepted — send RCPT TO
        step = 3;
        socket.write(`RCPT TO:<${email}>\r\n`);
      } else if (step === 3) {
        // RCPT TO response — check for 250/251 (accepted) vs 550/551/552/553 (rejected)
        clearTimeout(timer);
        socket.write(`QUIT\r\n`);
        socket.destroy();
        const code = parseInt(data.substring(0, 3), 10);
        resolve(code === 250 || code === 251);
      }
    });

    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });

    socket.on("timeout", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}
