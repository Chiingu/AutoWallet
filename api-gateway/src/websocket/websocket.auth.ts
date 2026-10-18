import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { parse } from "cookie";
import type { IncomingMessage } from "http";

export function authenticateWebSocket(request: IncomingMessage) {
  const cookies = parse(request.headers.cookie ?? "");
  const token = cookies[process.env.AUTH_COOKIE_NAME ?? "access_token"];

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
      return null;
    }
    console.log("web Socker reach the payload : ", payload);

    return {id: payload.sub, role: payload.role,};
  } catch {
    return null;
  }
}
