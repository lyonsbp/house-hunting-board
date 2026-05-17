import { test, expect } from "@playwright/test";

// The chromium project loads the seeded user's storageState. These tests
// assert what anonymous visitors see, so clear cookies for this file only.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("smoke (unauthenticated)", () => {
  test("login page renders email + Google sign-in", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: /sign in/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test("home redirects unauthenticated visitors to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a non-existent (or private) board renders 404 for anonymous visitors", async ({
    page,
  }) => {
    // Boards are anonymous-readable when public; private boards return null
    // through RLS and the route calls notFound(). Either way, an unknown id
    // should 404 rather than leak existence.
    const response = await page.goto(
      "/boards/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
  });
});
