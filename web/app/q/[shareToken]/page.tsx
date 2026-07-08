// Public client quote page (SPEC.md - Data flow, auth, and access): renders
// from an unguessable share token without authentication; an invalid token
// 404s. Accept state must never be stale, so the page always renders
// dynamically.

import { notFound } from "next/navigation";

import { AcceptButton } from "@/components/accept-button";
import { fetchQuoteByShareToken, type QuoteLineItemRow } from "@/lib/quotes";

export const dynamic = "force-dynamic";

function money(cents: number | null): string {
  if (cents == null) {
    return "—";
  }
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function quantityLabel(item: QuoteLineItemRow): string {
  return `${item.quantity} ${item.unit}`;
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  const quote = await fetchQuoteByShareToken(shareToken);
  if (!quote) {
    notFound();
  }

  const accepted = quote.status === "accepted";
  const acceptable = quote.status === "sent" || quote.status === "completed";
  const pending = quote.status === "generating";
  const failed = quote.status === "failed";
  const created = new Date(quote.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="quote-page">
      <header className="quote-header">
        <span className="brand">QuoteLens</span>
        <h1>Quote for {quote.job?.client_name ?? "your project"}</h1>
        <p className="quote-meta">
          {quote.job?.trade ? `${quote.job.trade} · ` : ""}
          Prepared {created}
        </p>
      </header>

      {accepted && (
        <div className="banner banner-accepted" data-testid="accepted-banner">
          Quote accepted. Your estimator has been notified.
        </div>
      )}
      {(pending || failed) && (
        <div className="banner banner-muted">
          This quote is still being prepared. Check back shortly.
        </div>
      )}

      <table className="line-items">
        <thead>
          <tr>
            <th scope="col">Work item</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Unit price
            </th>
            <th scope="col" className="num">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {quote.line_items.map((item) => (
            <tr key={item.id}>
              <td>{item.description}</td>
              <td className="num">{quantityLabel(item)}</td>
              <td className="num">
                {item.unit_price_cents == null ? (
                  <span className="unpriced">To be quoted</span>
                ) : (
                  money(item.unit_price_cents)
                )}
              </td>
              <td className="num">{money(item.total_cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td className="num" data-testid="subtotal">
              {money(quote.subtotal_cents)}
            </td>
          </tr>
        </tfoot>
      </table>

      {acceptable && <AcceptButton shareToken={shareToken} />}
      {accepted && (
        <p className="accept-footnote">
          Accepting recorded your agreement only — no payment was collected.
        </p>
      )}
    </main>
  );
}
