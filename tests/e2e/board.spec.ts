import { test, expect } from "@playwright/test";

test("user creates a board, then creates a category within it", async ({
  page,
}) => {
  await page.goto("/");

  const boardName = `Smoke Board ${Date.now()}`;
  const categoryName = `Smoke Cat ${Date.now()}`;

  await page.getByRole("textbox", { name: /new board/i }).fill(boardName);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: boardName }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);

  await expect(page.getByText(/No categories yet/)).toBeVisible();

  await page.getByRole("textbox", { name: /new category/i }).fill(categoryName);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(
    page.getByRole("button", { name: `Delete ${categoryName}` }),
  ).toBeVisible();
  await expect(page.getByText(/No categories yet/)).toBeHidden();

  await new Promise((r) => setTimeout(r, 10000));
});
