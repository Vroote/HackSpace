import type { NextRequest } from "next/server";
import { api, json } from "@/lib/http";
import { addMeasurement, selectDemoBuild } from "@/lib/workspace";

export async function POST(request: NextRequest) {
  return api(async () => json(await addMeasurement(request)));
}

export async function PATCH(request: NextRequest) {
  return api(async () => json(await selectDemoBuild(request)));
}
