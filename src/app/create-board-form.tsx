"use client";

import { useActionState } from "react";
import {
  Button,
  FieldError,
  Input,
  Label,
  TextField,
} from "@heroui/react";

import { createBoard, type CreateBoardState } from "./actions";

const initialState: CreateBoardState = { status: "idle" };

export function CreateBoardForm() {
  const [state, formAction, pending] = useActionState(
    createBoard,
    initialState,
  );

  return (
    <form action={formAction} className="flex items-end gap-2">
      <TextField
        name="name"
        isRequired
        isInvalid={state.status === "error"}
        className="flex-1"
      >
        <Label>New board</Label>
        <Input placeholder="e.g. 2026 Move" maxLength={120} />
        {state.status === "error" && <FieldError>{state.message}</FieldError>}
      </TextField>
      <Button type="submit" variant="primary" isDisabled={pending}>
        {pending ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
