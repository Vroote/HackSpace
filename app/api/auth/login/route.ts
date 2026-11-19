import { beginSignIn } from "@/lib/auth";
import { appOrigin, demoMode } from "@/lib/config";
import { api } from "@/lib/http";

export async function GET() {
  return api(() => demoMode() ? Response.redirect(new URL("/", appOrigin())) : beginSignIn());
}
