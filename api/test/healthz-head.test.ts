import { describe, expect, test } from "bun:test";
import { handleHealthz, handleHealthzHead } from "../src/health.ts";

describe("healthz", () => {
  test("GET answers 200 with the body a human reads in a terminal", async () => {
    const response = await handleHealthz();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  // Uptime monitors are routinely configured to probe with HEAD. Without an
  // explicit handler the route table has no HEAD entry, the request falls to
  // the catch-all and answers 404 -- so the monitor reports the api down while
  // it is serving GET perfectly. That is a false alarm at 3am about a service
  // that is fine, which is worse than no monitor at all.
  test("HEAD answers 200 too, so a HEAD-probing monitor does not cry wolf", async () => {
    const response = await handleHealthzHead();
    expect(response.status).toBe(200);
  });

  test("HEAD carries no body, per the method's contract", async () => {
    const response = await handleHealthzHead();
    expect(await response.text()).toBe("");
  });
});
