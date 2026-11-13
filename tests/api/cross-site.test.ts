import { describe, expect, test } from "vitest";
import { crossSite } from "../../apps/api/src/cross-site.ts";

const site = "https://revracers.com";
const elsewhere = "https://game.example.net";

function answer(): Response {
  return new Response(JSON.stringify({ driver: { id: "d1" } }), {
    status: 201,
    headers: { "content-type": "application/json", "x-kept": "yes" },
  });
}

describe("requests from another site", () => {
  test("a same-site request gets the handler's response untouched", async () => {
    const original = answer();
    const request = new Request(`${site}/api/players`, {
      method: "POST",
      headers: { origin: site },
    });
    const response = await crossSite(request, () => Promise.resolve(original));
    expect(response).toBe(original);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  test("a request without an origin gets the handler's response untouched", async () => {
    const original = answer();
    const response = await crossSite(new Request(`${site}/api/profile`), () =>
      Promise.resolve(original),
    );
    expect(response).toBe(original);
  });

  test("a preflight from another site is answered without reaching the API", async () => {
    let reached = false;
    const request = new Request(`${site}/api/me`, {
      method: "OPTIONS",
      headers: {
        origin: elsewhere,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    const response = await crossSite(request, () => {
      reached = true;
      return Promise.resolve(answer());
    });
    expect(reached).toBe(false);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const methods = response.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PUT"])
      expect(methods).toContain(method);
    const allowed = response.headers.get("access-control-allow-headers") ?? "";
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("content-type");
  });

  test("a sandboxed frame's null origin is treated as another site", async () => {
    const request = new Request(`${site}/api/profile`, {
      headers: { origin: "null" },
    });
    const response = await crossSite(request, () => Promise.resolve(answer()));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a request from another site keeps the API's status, headers and body", async () => {
    const request = new Request(`${site}/api/players`, {
      method: "POST",
      headers: { origin: elsewhere },
    });
    const response = await crossSite(request, () => Promise.resolve(answer()));
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-kept")).toBe("yes");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ driver: { id: "d1" } });
  });

  test("an API error from another site still reaches the game readable", async () => {
    const request = new Request(`${site}/api/me`, {
      method: "PUT",
      headers: { origin: elsewhere },
    });
    const response = await crossSite(request, () =>
      Promise.resolve(
        Response.json({ error: "Pick a team." }, { status: 400 }),
      ),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ error: "Pick a team." });
  });
});
