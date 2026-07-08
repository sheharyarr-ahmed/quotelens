"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AcceptButton({ shareToken }: { shareToken: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_token: shareToken }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `accept failed (${response.status})`);
      }
      // Server state changed; re-render the page in its accepted state.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "accept failed");
      setPending(false);
    }
  };

  return (
    <div className="accept-area">
      <button
        className="accept-button"
        disabled={pending}
        onClick={() => void accept()}
        type="button"
      >
        {pending ? "Accepting…" : "Accept quote"}
      </button>
      {error !== null && <p className="accept-error">{error}</p>}
    </div>
  );
}
