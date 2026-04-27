"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  Button,
  FieldError,
  Input,
  Label,
  TextField,
} from "@heroui/react";

import {
  createCategory,
  deleteCategory,
  type CreateCategoryState,
} from "./actions";

const initialState: CreateCategoryState = { status: "idle" };

export type Category = { id: string; name: string };

export function CategoriesSection({
  boardId,
  categories,
}: {
  boardId: string;
  categories: Category[];
}) {
  const [state, formAction, pending] = useActionState(
    createCategory,
    initialState,
  );

  // Clear the input after a successful create.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "idle" && !pending) {
      formRef.current?.reset();
    }
  }, [state, pending]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
        Categories
      </h2>

      {categories.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <li
              key={cat.id}
              className="border-default-200 flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
            >
              <span>{cat.name}</span>
              <form action={deleteCategory}>
                <input type="hidden" name="id" value={cat.id} />
                <input type="hidden" name="boardId" value={boardId} />
                <button
                  type="submit"
                  aria-label={`Delete ${cat.name}`}
                  className="text-default-400 hover:text-danger text-xs"
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm opacity-60">
          No categories yet. Add one to start grouping artifacts.
        </p>
      )}

      <form
        ref={formRef}
        action={formAction}
        className="flex items-end gap-2"
      >
        <input type="hidden" name="boardId" value={boardId} />
        <TextField
          name="name"
          isRequired
          isInvalid={state.status === "error"}
          className="flex-1"
        >
          <Label>New category</Label>
          <Input placeholder="e.g. Kitchens" maxLength={80} />
          {state.status === "error" && <FieldError>{state.message}</FieldError>}
        </TextField>
        <Button type="submit" variant="primary" isDisabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </form>
    </div>
  );
}
