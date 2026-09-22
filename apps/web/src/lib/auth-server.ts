import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";
import { getToken as readToken } from "@convex-dev/better-auth/utils";

import { ENV } from "../env.public";

const convexSiteUrl = ENV.VITE_CONVEX_SITE_URL;

// The local Cloudflare runtime used by `alchemy dev` injects `CF-Connecting-IP`
// (and its IPv6 variant) for the loopback client. Forwarding a client-supplied
// loopback address to Convex makes Cloudflare's edge reject the request with
// `403 error code: 1000`, so these headers must not be proxied onward.
const LOCAL_CONNECTION_HEADERS = ["cf-connecting-ip", "cf-connecting-ipv6"];

export const sanitizeForwardHeaders = (headers: HeadersInit) => {
  const sanitized = new Headers(headers);
  for (const name of LOCAL_CONNECTION_HEADERS) {
    sanitized.delete(name);
  }
  return sanitized;
};

const convexAuth = convexBetterAuthReactStart({
  convexUrl: ENV.VITE_CONVEX_URL,
  convexSiteUrl,
});

export const handler = (request: Request) =>
  convexAuth.handler(
    new Request(request, { headers: sanitizeForwardHeaders(request.headers) }),
  );

export const getToken = async () => {
  const { getRequestHeaders } = await import("@tanstack/react-start/server");
  const headers = sanitizeForwardHeaders(getRequestHeaders());
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("accept-encoding", "identity");
  const { token } = await readToken(convexSiteUrl, headers);
  return token;
};
