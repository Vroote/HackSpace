import type { NextRequest } from "next/server";
import { api, json } from "@/lib/http";
import { workspace } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  return api(async () => json(await workspace(request)));
}
