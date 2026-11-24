import { HttpError } from "./config";
import { GitHubError } from "./github";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function api(run: () => Response | Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof GitHubError) {
      const status = [401, 403, 404, 409, 422, 429].includes(error.status) ? error.status : 502;
      return json({ error: error.message }, status);
    }
    console.error("HackSpace request failed");
    return json({ error: "Внутренняя ошибка HackSpace. Проверьте конфигурацию сервера." }, 500);
  }
}

export async function requestBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new HttpError(415, "Ожидается JSON");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Пустой запрос");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 32_768) {
      await reader.cancel();
      throw new HttpError(413, "Запрос слишком большой");
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "Некорректный JSON");
  }
}

export function statusChange(body: Record<string, unknown>) {
  const { itemId, statusId } = body;
  if (typeof itemId !== "string" || !/^[\w=-]{1,200}$/.test(itemId) ||
    (statusId !== null && (typeof statusId !== "string" || !/^[\w=-]{1,200}$/.test(statusId)))) {
    throw new HttpError(422, "Некорректная карточка или статус");
  }
  return { itemId, statusId };
}

export function measurement(body: Record<string, unknown>) {
  const { sha, testedAt, score } = body;
  if (typeof sha !== "string" || !/^[a-f\d]{7,40}$/i.test(sha.trim())) {
    throw new HttpError(422, "Укажите SHA коммита (от 7 до 40 символов)");
  }
  if (typeof testedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(testedAt) || !Number.isFinite(Date.parse(testedAt))) {
    throw new HttpError(422, "Укажите корректное время теста");
  }
  const timestamp = new Date(testedAt).toISOString();
  if (timestamp.slice(0, 19) !== testedAt.slice(0, 19)) throw new HttpError(422, "Укажите корректное время теста");
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new HttpError(422, "Балл должен быть от 0 до 100");
  }
  const series = body.suite === undefined && body.version === undefined ? {} : {
    suite: boundedText(body.suite, 80, true), version: boundedText(body.version, 80, true),
  };
  return { ...series, sha: sha.trim().toLowerCase(), testedAt: timestamp, score };
}

function boundedText(value: unknown, max: number, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new HttpError(422, "Проверьте заполнение и длину текстовых полей");
  }
  return value.trim();
}

export function demoBuildInput(body: Record<string, unknown>) {
  const resultId = boundedText(body.resultId, 128, true);
  const reason = boundedText(body.reason, 500);
  const standUrl = boundedText(body.standUrl, 2048);
  if (standUrl) {
    let url: URL;
    try { url = new URL(standUrl); } catch { throw new HttpError(422, "Проверьте адрес стенда"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new HttpError(422, "Укажите HTTP(S)-адрес стенда без учётных данных");
    }
  }
  return { resultId, reason, standUrl };
}
