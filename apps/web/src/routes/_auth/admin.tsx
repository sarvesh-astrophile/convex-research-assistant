import { api } from "@convex-research-assistant/backend/convex/_generated/api";
import { Button } from "@convex-research-assistant/ui/components/button";
import { Input } from "@convex-research-assistant/ui/components/input";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_auth/admin")({ component: Admin });

function Admin() {
  const overview = useQuery(api.admin.overview, { period: new Date().toISOString().slice(0, 7) });
  const increase = useMutation(api.admin.increase);
  const [userId, setUserId] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [note, setNote] = useState("");
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Monthly spending · {overview?.period}</h1>
      <p className="mt-2 text-sm">
        Default cap: ${overview?.defaultCapUsd ?? "…"}. Only the configured admin can access this
        data.
      </p>
      <div className="mt-6 space-y-3">
        {overview?.accounts.map((account) => (
          <div key={account._id} className="border p-3 text-sm">
            <span className="break-all font-medium">{account.userId}</span> · spent $
            {(account.spentNanos / 1e9).toFixed(4)} · reserved $
            {(account.reservedNanos / 1e9).toFixed(4)} · added $
            {(account.increaseNanos / 1e9).toFixed(2)}
          </div>
        ))}
      </div>
      <form
        className="mt-8 grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await increase({ userId, amountUsd: Number(amountUsd), note });
            toast.success("One-time increase recorded.");
            setAmountUsd("");
            setNote("");
          } catch (error) {
            toast.error(String(error));
          }
        }}
      >
        <h2 className="font-semibold">Grant a one-time increase for this UTC month</h2>
        <Input
          aria-label="User ID"
          placeholder="User ID"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          required
        />
        <Input
          aria-label="Increase in USD"
          placeholder="USD"
          type="number"
          min="0.01"
          max="100"
          step="0.01"
          value={amountUsd}
          onChange={(event) => setAmountUsd(event.target.value)}
          required
        />
        <Input
          aria-label="Reason"
          placeholder="Reason"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          required
        />
        <Button type="submit">Grant increase</Button>
      </form>
    </main>
  );
}
