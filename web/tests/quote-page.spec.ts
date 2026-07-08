// SPEC Verification #4: "pnpm playwright test green on the web quote page:
// renders from share token, Accept persists, invalid token 404s."

import { expect, test } from "@playwright/test";

import { serviceClient } from "./support";

const renderToken = () => process.env.PW_RENDER_TOKEN!;
const acceptToken = () => process.env.PW_ACCEPT_TOKEN!;
const acceptId = () => process.env.PW_ACCEPT_ID!;

test("renders a quote from its share token without authentication", async ({
  page,
}) => {
  await page.goto(`/q/${renderToken()}`);
  await expect(
    page.getByRole("heading", { name: /Quote for Playwright Client/ }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByText("Treat ceiling water stain")).toBeVisible();
  // The unpriced line renders as awaiting a price, never an invented one.
  await expect(page.getByText("To be quoted")).toBeVisible();
  await expect(page.getByTestId("subtotal")).toHaveText("$161.00");
  await expect(
    page.getByRole("button", { name: "Accept quote" }),
  ).toBeVisible();
});

test("invalid tokens 404 — unknown and malformed answer identically", async ({
  page,
}) => {
  const unknown = await page.goto(`/q/${"0".repeat(48)}`);
  expect(unknown?.status()).toBe(404);
  await expect(page.getByText("Quote not found")).toBeVisible();

  const malformed = await page.goto("/q/not-a-token");
  expect(malformed?.status()).toBe(404);
  await expect(page.getByText("Quote not found")).toBeVisible();
});

test("Accept persists: UI state survives reload and the DB records it", async ({
  page,
}) => {
  await page.goto(`/q/${acceptToken()}`);
  await page.getByRole("button", { name: "Accept quote" }).click();
  await expect(page.getByTestId("accepted-banner")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("accepted-banner")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept quote" }),
  ).toHaveCount(0);

  const client = serviceClient();
  const { data: quote } = await client
    .from("quotes")
    .select("status")
    .eq("id", acceptId())
    .single();
  expect(quote?.status).toBe("accepted");
  const { data: events } = await client
    .from("quote_events")
    .select("id, event_type")
    .eq("quote_id", acceptId())
    .eq("event_type", "quote_accepted");
  expect(events).toHaveLength(1);
});

test("a second accept is idempotent — no duplicate agreement event", async ({
  request,
}) => {
  const again = await request.post("/api/accept", {
    data: { share_token: acceptToken() },
  });
  expect(again.status()).toBe(200);
  expect(await again.json()).toEqual({ status: "accepted" });

  const client = serviceClient();
  const { data: events } = await client
    .from("quote_events")
    .select("id")
    .eq("quote_id", acceptId())
    .eq("event_type", "quote_accepted");
  expect(events).toHaveLength(1);
});

test("concurrent accepts record exactly one agreement event", async ({
  request,
}) => {
  const raceToken = process.env.PW_RACE_TOKEN!;
  const raceId = process.env.PW_RACE_ID!;
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      request.post("/api/accept", { data: { share_token: raceToken } }),
    ),
  );
  for (const response of responses) {
    expect(response.status()).toBe(200);
  }

  const client = serviceClient();
  const { data: quote } = await client
    .from("quotes")
    .select("status")
    .eq("id", raceId)
    .single();
  expect(quote?.status).toBe("accepted");
  const { data: events } = await client
    .from("quote_events")
    .select("id")
    .eq("quote_id", raceId)
    .eq("event_type", "quote_accepted");
  expect(events).toHaveLength(1);
});
