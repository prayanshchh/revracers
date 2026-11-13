const openHeaders = {
  "access-control-allow-origin": "*",
};

const preflightHeaders = {
  ...openHeaders,
  "access-control-allow-methods": "GET, POST, PUT",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function fromAnotherSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

export async function crossSite(
  request: Request,
  handle: () => Promise<Response>,
): Promise<Response> {
  if (!fromAnotherSite(request)) return handle();
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: preflightHeaders });
  const response = await handle();
  const open = new Response(response.body, response);
  for (const [name, value] of Object.entries(openHeaders))
    open.headers.set(name, value);
  return open;
}
