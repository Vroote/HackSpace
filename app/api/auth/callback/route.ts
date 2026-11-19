import type { NextRequest } from "next/server";
import { finishSignIn } from "@/lib/auth";
import { demoMode, HttpError } from "@/lib/config";
import { api } from "@/lib/http";

export async function GET(request: NextRequest) {
  return api(() => {
    if (demoMode()) throw new HttpError(404, "GitHub-вход отключён в демо");
    return finishSignIn(request);
  });
}
