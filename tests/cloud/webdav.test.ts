import { afterEach, describe, expect, it, vi } from "vitest";
import { testWebDavConnection } from "../../src/cloud/webdav";

const config = {
  baseUrl: "https://dav.jianguoyun.com/dav/",
  username: "user@example.com",
  password: "app-password",
  remoteDir: "客户提醒备份",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebDAV cloud backup", () => {
  it("accepts a successful Jianguoyun PROPFIND response", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 207 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(testWebDavConnection(config)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dav.jianguoyun.com/dav/",
      expect.objectContaining({
        method: "PROPFIND",
        headers: expect.objectContaining({
          Depth: "0",
          Authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
  });

  it.each([
    [401, "jianguoyun_credentials_invalid"],
    [403, "jianguoyun_access_denied"],
    [404, "jianguoyun_url_invalid"],
    [500, "jianguoyun_connection_failed"],
  ])("maps WebDAV status %s to a readable error", async (status, errorCode) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));

    await expect(testWebDavConnection(config)).rejects.toThrow(errorCode);
  });

  it("times out a hanging Jianguoyun request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const promise = expect(testWebDavConnection(config)).rejects.toThrow("jianguoyun_request_timeout");
    await vi.advanceTimersByTimeAsync(10000);
    await promise;
    vi.useRealTimers();
  });
});
