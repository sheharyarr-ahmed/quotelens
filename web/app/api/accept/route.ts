import { NextResponse } from "next/server";

import { acceptQuoteByShareToken } from "@/lib/quotes";

// Accept records agreement only - no payment collection (SPEC.md - Out of
// scope). Unknown and malformed tokens answer identically (404) so the
// endpoint is not an oracle for token format or existence.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    share_token?: string;
  } | null;
  if (!body?.share_token) {
    return NextResponse.json({ error: "share_token required" }, { status: 400 });
  }
  const result = await acceptQuoteByShareToken(body.share_token);
  switch (result.outcome) {
    case "accepted":
    case "already_accepted":
      return NextResponse.json({ status: "accepted" });
    case "not_acceptable":
      return NextResponse.json(
        { error: `quote is ${result.status}` },
        { status: 409 },
      );
    case "not_found":
      return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
