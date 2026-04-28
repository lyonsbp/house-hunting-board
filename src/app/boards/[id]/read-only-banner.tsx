export function ReadOnlyBanner({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      You&apos;re viewing this board read-only.
      {signedIn ? (
        " Only board editors can add, comment, or edit."
      ) : (
        <>
          {" "}
          <a href="/login" className="font-medium underline hover:text-amber-700">
            Sign in
          </a>{" "}
          if you&apos;ve been invited to edit.
        </>
      )}
    </div>
  );
}
