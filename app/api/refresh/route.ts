import type { NextRequest } from "next/server";
import { api, json } from "@/lib/http";
import { refreshWorkspace } from "@/lib/workspace";

export async function POST(request: NextRequest) {
  return api(async () => json(await refreshWorkspace(request)));
}
