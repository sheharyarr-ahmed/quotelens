// Public client quote page (SPEC.md - Data flow, auth, and access): renders
// from an unguessable share token without authentication. Data fetching and
// the Accept flow land next milestone; an invalid token will 404.

export default async function QuotePage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  return (
    <main>
      <h1>Quote</h1>
      <p>Quote for share token {shareToken} renders here.</p>
    </main>
  );
}
