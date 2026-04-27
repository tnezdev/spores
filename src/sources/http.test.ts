import { describe, expect, test } from "bun:test"
import { HttpSource } from "./http.js"

function makeFetcher(
  routes: Record<string, { status: number; body?: string; statusText?: string }>,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString()
    const route = routes[url]
    if (route === undefined) {
      return new Response("not configured", { status: 500 })
    }
    return new Response(route.body ?? "", {
      status: route.status,
      statusText: route.statusText ?? "",
    })
  }) as typeof fetch
}

describe("HttpSource", () => {
  test("read returns text + url locator on 200", async () => {
    const fetcher = makeFetcher({
      "https://cdn.example/personas/dottie.md": { status: 200, body: "hello" },
    })
    const source = new HttpSource({
      urlForName: (n) => `https://cdn.example/personas/${n}.md`,
      fetcher,
    })
    const record = await source.read("dottie")
    expect(record).toEqual({
      text: "hello",
      locator: "https://cdn.example/personas/dottie.md",
    })
  })

  test("read returns undefined on 404", async () => {
    const fetcher = makeFetcher({
      "https://cdn.example/missing.md": { status: 404 },
    })
    const source = new HttpSource({
      urlForName: (n) => `https://cdn.example/${n}.md`,
      fetcher,
    })
    expect(await source.read("missing")).toBeUndefined()
  })

  test("read throws on non-404 error responses", async () => {
    const fetcher = makeFetcher({
      "https://cdn.example/dottie.md": {
        status: 500,
        statusText: "Internal Server Error",
      },
    })
    const source = new HttpSource({
      urlForName: (n) => `https://cdn.example/${n}.md`,
      fetcher,
    })
    expect(source.read("dottie")).rejects.toThrow(/500/)
  })

  test("urlForName lets the caller encode any URL convention", async () => {
    const seen: string[] = []
    const fetcher = (async (url: string | URL | Request) => {
      seen.push(typeof url === "string" ? url : url.toString())
      return new Response("ok", { status: 200 })
    }) as typeof fetch
    const source = new HttpSource({
      urlForName: (n) => `https://api.example/v1/personas?name=${encodeURIComponent(n)}`,
      fetcher,
    })
    await source.read("dottie weaver")
    expect(seen[0]).toBe(
      "https://api.example/v1/personas?name=dottie%20weaver",
    )
  })

  test("custom fetcher sees the request — auth/signing happens here", async () => {
    let signedHeader: string | undefined
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      signedHeader = headers.get("authorization") ?? undefined
      return new Response("body", { status: 200 })
    }) as typeof fetch

    const signing: typeof fetch = (async (url, init = {}) => {
      const headers = new Headers(init.headers)
      headers.set("authorization", "Signed test-token")
      return fetcher(url, { ...init, headers })
    }) as typeof fetch

    const source = new HttpSource({
      urlForName: () => "https://api.example/x",
      fetcher: signing,
    })
    await source.read("anything")
    expect(signedHeader).toBe("Signed test-token")
  })

  test("list throws when no listFromIndex is provided", async () => {
    const source = new HttpSource({
      urlForName: () => "https://x",
      fetcher: makeFetcher({}),
    })
    expect(source.list()).rejects.toThrow(/listFromIndex/)
  })

  test("list returns sorted names from listFromIndex", async () => {
    const source = new HttpSource({
      urlForName: () => "https://x",
      fetcher: makeFetcher({}),
      listFromIndex: async () => ["zebra", "alpha", "mike"],
    })
    expect(await source.list()).toEqual(["alpha", "mike", "zebra"])
  })
})
