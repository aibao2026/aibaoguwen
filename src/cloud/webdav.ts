import { basename } from "node:path";

export interface WebDavConfig {
  baseUrl: string;
  username: string;
  password: string;
  remoteDir: string;
}

export interface CloudBackupFile {
  fileName: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

const WEBDAV_REQUEST_TIMEOUT_MS = 10000;

function authHeader(config: WebDavConfig): string {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
}

function encodePathPart(part: string): string {
  return encodeURIComponent(part).replace(/%2F/g, "/");
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function webDavStatusError(status: number, fallback: string) {
  if (status === 401) return "jianguoyun_credentials_invalid";
  if (status === 403) return "jianguoyun_access_denied";
  if (status === 404) return "jianguoyun_url_invalid";
  return fallback;
}

function remoteUrl(config: WebDavConfig, fileName?: string): string {
  const parts = config.remoteDir
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (fileName) {
    parts.push(fileName);
  }
  return `${normalizeBaseUrl(config.baseUrl)}${parts.map(encodePathPart).join("/")}${fileName ? "" : "/"}`;
}

async function webdavFetch(config: WebDavConfig, url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        Authorization: authHeader(config),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("jianguoyun_request_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testWebDavConnection(config: WebDavConfig): Promise<void> {
  const response = await webdavFetch(config, normalizeBaseUrl(config.baseUrl), {
    method: "PROPFIND",
    headers: { Depth: "0" },
  });
  if (![200, 207].includes(response.status)) {
    throw new Error(webDavStatusError(response.status, "jianguoyun_connection_failed"));
  }
}

export async function ensureWebDavDirectory(config: WebDavConfig): Promise<void> {
  const parts = config.remoteDir
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  let current = normalizeBaseUrl(config.baseUrl);
  for (const part of parts) {
    current = `${current}${encodePathPart(part)}/`;
    const response = await webdavFetch(config, current, { method: "MKCOL" });
    if (![201, 405].includes(response.status)) {
      throw new Error(webDavStatusError(response.status, "jianguoyun_directory_failed"));
    }
  }
}

export async function uploadWebDavFile(
  config: WebDavConfig,
  fileName: string,
  body: Buffer,
): Promise<void> {
  await ensureWebDavDirectory(config);
  const response = await webdavFetch(config, remoteUrl(config, fileName), {
    method: "PUT",
    body: new Uint8Array(body),
  });
  if (![200, 201, 204].includes(response.status)) {
    throw new Error(webDavStatusError(response.status, "jianguoyun_upload_failed"));
  }
}

export async function downloadWebDavFile(config: WebDavConfig, fileName: string): Promise<Buffer> {
  const response = await webdavFetch(config, remoteUrl(config, basename(fileName)), { method: "GET" });
  if (response.status !== 200) {
    throw new Error(webDavStatusError(response.status, "jianguoyun_download_failed"));
  }
  return Buffer.from(await response.arrayBuffer());
}

function textBetween(input: string, tag: string): string | undefined {
  const match = new RegExp(`<[^>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, "i").exec(input);
  return match?.[1]?.trim();
}

export async function listWebDavFiles(config: WebDavConfig): Promise<CloudBackupFile[]> {
  await ensureWebDavDirectory(config);
  const response = await webdavFetch(config, remoteUrl(config), {
    method: "PROPFIND",
    headers: {
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/><getcontentlength/><getlastmodified/></prop></propfind>`,
  });
  if (response.status !== 207) {
    throw new Error(webDavStatusError(response.status, "jianguoyun_list_failed"));
  }
  const xml = await response.text();
  const responses = xml.split(/<[^>]*:?response[^>]*>/i).slice(1);
  return responses
    .map((item) => {
      const href = textBetween(item, "href");
      const displayName = textBetween(item, "displayname");
      const fileName = displayName || (href ? decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "") : "");
      const sizeText = textBetween(item, "getcontentlength");
      const modifiedAt = textBetween(item, "getlastmodified");
      return {
        fileName,
        sizeBytes: sizeText ? Number(sizeText) : undefined,
        modifiedAt,
      };
    })
    .filter((item) => item.fileName.endsWith(".sqlite"))
    .sort((left, right) => (right.modifiedAt ?? "").localeCompare(left.modifiedAt ?? ""));
}
