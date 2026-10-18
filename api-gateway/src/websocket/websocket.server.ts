import { WebSocketServer } from "ws";
import type { Server } from "http";
import { authenticateWebSocket } from "./websocket.auth.js";
import {
  addConnection,
  removeConnection,
} from "./connection.manager.js";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

      if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    if (request.headers.origin !== process.env.FRONTEND_ORIGIN) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const user = authenticateWebSocket(request);

    // const user = {
    //   id: "user_123",
    //   role: "client",
    // }

    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // ws ===> is webSocket interface that we use it to communicat through this connection.
    // ws.send(data)
    // ws.on("close", ...)
    // ws.on("error", ...)
    // ws.on("message", ...)
    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log(`User ${user.id} connected`);

      addConnection(user.id, ws);

      ws.on("close", () => {
        removeConnection(user.id, ws);
      });

      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    console.log("WebSocket client connected");

    ws.send("WebSocket connection established");

    ws.on("message", (message) => {
      console.log("Message received:", message.toString());

      ws.send(JSON.stringify({
        event: "test.ack",
        data: {
          received: message.toString(),
        },
      }));
    });

    ws.on("close", () => {
      console.log("WebSocket disconnected");
    });
  });

  // wss.on("connection", (ws) => {
  //   ws.send("WebSocket connection established");
  //
  //   ws.on("close", () => {
  //     console.log("WebSocket disconnected");
  //   });
  // });

  return wss;
}
