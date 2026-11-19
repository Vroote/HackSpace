import type { NextRequest } from "next/server";
import { checkOrigin, endSignIn } from "@/lib/auth";
import { appOrigin, demoMode } from "@/lib/config";
import { api } from "@/lib/http";

export async function POST(request: NextRequest) {
  return api(() => {
    checkOrigin(request);
    return demoMode() ? Response.redirect(new URL("/", appOrigin()), 303) : endSignIn(request);
  });
}
