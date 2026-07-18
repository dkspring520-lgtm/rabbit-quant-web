const defaultOrigin = "http://control:3010";

async function proxy(request: Request) {
  const incoming = new URL(request.url);
  const suffix = incoming.pathname.replace(/^\/api\/control/, "") || "/";
  const origin = (process.env.CONTROL_PLANE_ORIGIN || defaultOrigin).replace(/\/$/, "");
  const upstream = new URL(`${origin}${suffix}`);
  upstream.search = incoming.search;
  const headers = new Headers();
  for (const name of ["cookie", "content-type", "accept", "user-agent"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  const response = await fetch(upstream, { method: request.method, headers, body, redirect: "manual", cache: "no-store" });
  const outgoing = new Headers();
  for (const name of ["content-type", "cache-control", "set-cookie", "location"]) {
    const value = response.headers.get(name);
    if (value) outgoing.set(name, value);
  }
  outgoing.set("cache-control", "no-store, private");
  return new Response(response.body, { status: response.status, headers: outgoing });
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
