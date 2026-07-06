import { NextResponse } from "next/server";

// Accept records agreement only - no payment collection (SPEC.md - Out of
// scope). Persists a quote_accepted quote_events row next milestone.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    share_token?: string;
  } | null;
  if (!body?.share_token) {
    return NextResponse.json({ error: "share_token required" }, { status: 400 });
  }
  return NextResponse.json(
    { error: "not implemented yet" },
    { status: 501 },
  );
}
