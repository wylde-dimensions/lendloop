import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { BoardShell, BoardShellSkeleton } from "@/components/board/board-shell";

/**
 * Everything under (board) needs an account. The session read happens per
 * request, so it sits behind Suspense and the static shell still streams first.
 * This check is for UX (redirect to sign-in); the data itself is protected in
 * Convex, where every function re-checks identity and role.
 */
export default function BoardLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<BoardShellSkeleton />}>
      <RequireSignIn>{children}</RequireSignIn>
    </Suspense>
  );
}

async function RequireSignIn({ children }: { children: React.ReactNode }) {
  await auth.protect();
  return <BoardShell>{children}</BoardShell>;
}
