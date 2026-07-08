// Invalid share tokens land here with a 404 status (SPEC Verification #4).
// Unknown and malformed tokens render identically: the page must not act as
// an oracle for token format.
export default function NotFound() {
  return (
    <main className="not-found-page">
      <h1>Quote not found</h1>
      <p>
        This link is invalid or no longer available. Ask your estimator to
        share the quote again.
      </p>
    </main>
  );
}
