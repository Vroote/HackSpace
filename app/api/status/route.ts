import type { NextRequest } from "next/server";
import { api, json } from "@/lib/http";
import { moveCard } from "@/lib/workspace";

export async function PATCH(request: NextRequest) {
  return api(async () => json(await moveCard(request)));
}
