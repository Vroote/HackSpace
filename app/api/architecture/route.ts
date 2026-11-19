import type { NextRequest } from "next/server";
import { api, json } from "@/lib/http";
import { previewArchitecture, startArchitecture } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  return api(async () => json(await previewArchitecture(request)));
}

export async function POST(request: NextRequest) {
  return api(async () => json(await startArchitecture(request)));
}
