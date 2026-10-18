import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { createServer } from "../src/server.js";
import type { Server } from "http";

describe("WebSocket", () => {
    let server: Server;

    afterEach(async () => {
        if (server?.listening) {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    });

    it("accepts an authenticated WebSocket connection", async () => {
        const secret = process.env.JWT_SECRET ?? "qa-test-secret";
        if (!secret) {
            throw new Error("JWT_SECRET is not configured for tests");
        }

        server = createServer();

        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });

        const address = server.address();

        if (!address || typeof address === "string") {
            throw new Error("Could not get server address");
        }

        const token = jwt.sign(
            { role: "USER" },
            secret,
            { subject: "test-user" },
        );

        const cookieName =
            process.env.AUTH_COOKIE_NAME ?? "access_token";

        const ws = new WebSocket(
            `ws://127.0.0.1:${address.port}/ws`,
            {
                headers: {
                    Cookie: `${cookieName}=${token}`,
                },
            },
        );

        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => {
                expect(ws.readyState).toBe(WebSocket.OPEN);
                ws.close();
                resolve();
            });

            ws.once("error", reject);
        });
    });
});

// import { describe, it, expect, afterEach } from "vitest";
// import WebSocket from "ws";
// import { createServer } from "../src/server.js";
// import type { Server } from "http";
//
// describe("WebSocket", () => {
//     let server: Server;
//
//     afterEach(() => {
//         server.close();
//     });
//
//     it("accepts a WebSocket connection", async () => {
//         server = createServer();
//
//         await new Promise<void>((resolve) => {
//             server.listen(0, resolve);
//         });
//
//         const address = server.address();
//
//         if (!address || typeof address === "string") {
//             throw new Error("Could not get server address");
//         }
//
//         const ws = new WebSocket(`ws://localhost:${address.port}/ws`);
//
//         await new Promise<void>((resolve, reject) => {
//             ws.on("open", () => {
//                 expect(ws.readyState).toBe(WebSocket.OPEN);
//                 ws.close();
//                 resolve();
//             });
//
//             ws.on("error", reject);
//         });
//     });
// });
