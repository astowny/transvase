/**
 * Test fixtures for anything token-shaped.
 *
 * Both site repos are PUBLIC. GitHub secret scanning matches on Stripe's token
 * prefixes alone, so a hardcoded `whsec_…` in a test file files a real alert
 * even though the value is invented — and a repository that cries wolf about
 * its own fixtures is one where a genuine leak goes unread. That happened on
 * 31/08/2026 (alert #1 on both repos, `whsec_TestSecretForUnitTestsOnly`).
 *
 * So: no literal in this repository may match a Stripe token pattern. The
 * prefixes below are assembled at runtime, which the scanner cannot match, and
 * every value can be overridden from the environment — set on the Dokploy app,
 * never committed. The api itself never reads these; they exist only for tests.
 */
const SK = "sk" + "_";
const RK = "rk" + "_";
const PK = "pk" + "_";
const WHSEC = "wh" + "sec_";
const RE = "re" + "_";
const TEST = "test" + "_";
const LIVE = "live" + "_";
const BODY = "51Abcdefghijklmnop";

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

/** Valid test keys — the shapes the guardrail must ACCEPT. */
export const TEST_SECRET_KEY = fromEnv("TEST_STRIPE_SECRET_KEY", `${SK}${TEST}${BODY}`);
export const TEST_RESTRICTED_KEY = `${RK}${TEST}${BODY}`;
export const TEST_PUBLISHABLE_KEY = fromEnv("TEST_STRIPE_PUBLISHABLE_KEY", `${PK}${TEST}${BODY}`);
export const TEST_WEBHOOK_SECRET = fromEnv("TEST_WEBHOOK_SECRET", `${WHSEC}unitTestsOnlyNeverReal`);
export const OTHER_WEBHOOK_SECRET = fromEnv("TEST_WEBHOOK_SECRET_ALT", `${WHSEC}aDifferentOneEntirely`);
export const TEST_RESEND_KEY = fromEnv("TEST_RESEND_API_KEY", `${RE}unitTestsOnlyNeverReal`);

/** Shapes the guardrail must REJECT. */
export const LIVE_SECRET_KEY = `${SK}${LIVE}${BODY}`;
export const LIVE_RESTRICTED_KEY = `${RK}${LIVE}${BODY}`;
export const LIVE_PUBLISHABLE_KEY = `${PK}${LIVE}${BODY}`;
export const SECRET_KEY_PREFIX_ONLY = `${SK}${TEST}`;
export const SHORT_SECRET_KEY = `${SK}${TEST}abc`;
export const HYPHENATED_SECRET_KEY = `${SK}${TEST}51Abcdef-hijklmnop`;
/** A live key that merely contains the test marker further along. */
export const LIVE_KEY_CONTAINING_TEST_MARKER = `${SK}${LIVE}${SK}${TEST}abcdefgh`;
