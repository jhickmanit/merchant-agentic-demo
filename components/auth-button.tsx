"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AuthButton({ user }: { user: { email: string } | null }) {
  if (!user) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm">Sign in</Button>
      </Link>
    );
  }
  return (
    <form action="/logout" method="post" className="contents">
      <span className="text-sm text-muted-foreground hidden md:inline">{user.email}</span>
      <Button type="submit" variant="outline" size="sm">Sign out</Button>
    </form>
  );
}
