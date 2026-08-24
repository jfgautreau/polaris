import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  const supabase = await getServerClient();
  await supabase.auth.signOut();
  // 303 See Other : après un POST, force le navigateur à faire un GET sur
  // /login. Sans ça, le défaut 307 préserve la méthode → le navigateur
  // re-POST vers /login (une page GET-only) et reçoit un 405.
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
