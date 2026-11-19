import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, HttpError, oauthConfig, repoConfig } from "./config";
import { matches, randomToken, seal, sha256, unseal } from "./crypto";
import { database, getSession } from "./db";
import { githubAccess, githubViewer } from "./github";

const cookieName = "hackspace_session";
const oauthCookie = "hackspace_oauth";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: appOrigin().startsWith("https:"), path: "/", maxAge };
}

export function checkOrigin(request: NextRequest) {
  if (request.headers.get("origin") !== appOrigin()) {
    throw new HttpError(403, "Запрос с другого сайта отклонён");
  }
}

export function demoRequest(request: NextRequest) {
  if (request.headers.get("host") !== new URL(appOrigin()).host) {
    throw new HttpError(403, "Демо доступно только по локальному адресу приложения");
  }
}

export function beginSignIn() {
  const { clientId, redirectUri } = oauthConfig();
  const state = randomToken();
  const verifier = randomToken();
  const redirect = new URL("https://github.com/login/oauth/authorize");
  redirect.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, state, code_challenge: sha256(verifier),
    code_challenge_method: "S256", scope: "offline_access",
  }).toString();
  const response = NextResponse.redirect(redirect);
  response.cookies.set(oauthCookie, `${state}.${verifier}`, cookieOptions(600));
  return response;
}

export async function finishSignIn(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", appOrigin()));
  response.cookies.set(oauthCookie, "", cookieOptions(0));
  try {
    const { clientId, clientSecret, redirectUri } = oauthConfig();
    const { searchParams } = request.nextUrl;
    const [storedState, verifier] = request.cookies.get(oauthCookie)?.value.split(".") ?? [];
    const state = searchParams.get("state");
    const code = searchParams.get("code");
    if (!state || !code || !storedState || !verifier || !tokenPattern.test(verifier) || !matches(state, storedState)) {
      throw new Error("Invalid OAuth callback");
    }
    const exchange = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, code_verifier: verifier }),
    });
    if (!exchange.ok) throw new Error("OAuth exchange failed");
    const { access_token: token, expires_in: expires } = await exchange.json();
    if (typeof token !== "string" || !token.startsWith("ghu_") || !Number.isInteger(expires) || expires <= 0) {
      throw new Error("Expected an expiring GitHub App user token");
    }
    const [person] = await Promise.all([githubViewer(token), githubAccess(token, repoConfig())]);
    const id = randomToken();
    const deadline = Math.min(expires, 28_800);
    const previous = request.cookies.get(cookieName)?.value;
    await database().query("DELETE FROM sessions WHERE expires_at <= now() OR id = $1",
      [previous && tokenPattern.test(previous) ? sha256(previous) : ""]);
    await database().query("INSERT INTO sessions (id, token, person, expires_at) VALUES ($1, $2, $3, $4)",
      [sha256(id), seal(token, sha256(id)), person, new Date(Date.now() + deadline * 1000)]);
    response.cookies.set(cookieName, id, cookieOptions(deadline));
  } catch {
    response.headers.set("location", new URL("/?auth=failed", appOrigin()).toString());
  }
  return response;
}

export async function endSignIn(request: NextRequest) {
  const value = request.cookies.get(cookieName)?.value;
  if (value && tokenPattern.test(value)) {
    await database().query("DELETE FROM sessions WHERE id = $1", [sha256(value)]);
  }
  const response = NextResponse.redirect(new URL("/", appOrigin()), 303);
  response.cookies.set(cookieName, "", cookieOptions(0));
  return response;
}

export async function liveSession(request: NextRequest) {
  const raw = request.cookies.get(cookieName)?.value;
  const session = raw && tokenPattern.test(raw) ? await getSession(sha256(raw)) : null;
  if (!session) throw new HttpError(401, "Войдите через GitHub");
  const token = unseal(session.token, session.id);
  const config = repoConfig();
  const access = await githubAccess(token, config);
  return { session, token, config, access };
}
