import dotenv from "dotenv";
import app from "./app.js";
import http from "http";
import { setupWebSocket } from "./websocket/websocket.server.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

export function createServer() {
    const server = http.createServer(app);

    setupWebSocket(server);

    return server;
}

export function startServer() {
    const server = createServer();

    server.listen(PORT, () => {
        console.log(`API gateway running on port ${PORT}`);
    });

    return server;
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    startServer();
}
