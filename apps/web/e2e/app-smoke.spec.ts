import { expect, test } from "@playwright/test";

test("home page loads without legacy CLOB SDK browser errors", async ({
  page,
}) => {
  const browserErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator("body")).toBeAttached();

  expect(
    browserErrors.filter((message) => message.includes("clob-client-v2"))
  ).toEqual([]);
});
