"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAgentAction } from "@/app/me/agents/actions";

export function RegisterAgentForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const formData = new FormData(e.currentTarget);
        const displayName = String(formData.get("displayName") || "");
        const agentType = (String(formData.get("agentType") || "shopping")) as
          | "shopping"
          | "research"
          | "general";
        const spendCapDollars = parseFloat(
          String(formData.get("spendCapDollars") || "0"),
        );
        const spendCapCents =
          isFinite(spendCapDollars) && spendCapDollars > 0
            ? Math.round(spendCapDollars * 100)
            : undefined;
        const expiresAt = String(formData.get("expiresAt") || "") || undefined;

        startTransition(async () => {
          try {
            await registerAgentAction({
              displayName,
              agentType,
              spendCapCents,
              expiresAt,
            });
            router.push("/me/agents");
          } catch (err) {
            setError((err as Error).message ?? "Failed to register");
          }
        });
      }}
      className="space-y-5 max-w-lg"
    >
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" required placeholder="e.g. PantryRestocker" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="agentType">Agent type</Label>
        <select
          id="agentType"
          name="agentType"
          defaultValue="shopping"
          className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="shopping">Shopping</option>
          <option value="research">Research</option>
          <option value="general">General</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="spendCapDollars">Spend cap (USD)</Label>
        <Input
          id="spendCapDollars"
          name="spendCapDollars"
          type="number"
          step="0.01"
          min="0"
          placeholder="200.00"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="expiresAt">Expires (optional)</Label>
        <Input id="expiresAt" name="expiresAt" type="date" />
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Registering…" : "Register agent"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
