import { NextRequest, NextResponse } from "next/server";
import { authenticate, db, fail } from "@/lib/server";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (auth.res) return auth.res;

  const { data, error } = await db
    .from("channels")
    .select("id, title, username, is_active")
    .eq("owner_id", auth.user.id)
    .order("created_at");

  if (error) return fail(500, "خطأ في قاعدة البيانات.");
  return NextResponse.json({ channels: data });
}
