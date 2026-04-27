"use client";

import { useActionState } from "react";
import {
  Button,
  Card,
  CardContent,
  FieldError,
  Input,
  Label,
  Separator,
  TextField,
} from "@heroui/react";

import { sendMagicLink, signInWithGoogle, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    sendMagicLink,
    initialState,
  );

  if (state.status === "sent") {
    return (
      <Card>
        <CardContent>
          <p className="text-sm">
            Check <span className="font-semibold">{state.email}</span> for a
            sign-in link.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={signInWithGoogle}>
        <Button type="submit" variant="outline" fullWidth>
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs uppercase tracking-wide opacity-60">or</span>
        <Separator className="flex-1" />
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <TextField
          name="email"
          type="email"
          autoComplete="email"
          isRequired
          isInvalid={state.status === "error"}
        >
          <Label>Email</Label>
          <Input placeholder="you@example.com" />
          {state.status === "error" && <FieldError>{state.message}</FieldError>}
        </TextField>
        <Button
          type="submit"
          variant="primary"
          isDisabled={pending}
          fullWidth
        >
          {pending ? "Sending…" : "Send magic link"}
        </Button>
      </form>
    </div>
  );
}
