import WebSocket from "ws";

const connections = new Map<string, Set<WebSocket>>();

export function addConnection(userId: string, ws: WebSocket) {
  let userConnections = connections.get(userId);

  if (!userConnections) {
    userConnections = new Set<WebSocket>();
    connections.set(userId, userConnections);
  }
  userConnections.add(ws);
}

export function removeConnection(userId: string, ws: WebSocket) {
  const userConnections = connections.get(userId);

  if (!userConnections) {
    return;
  }

  userConnections.delete(ws);

  if (userConnections.size === 0) {
    connections.delete(userId);
  }
}

export function sendToUser(userId: string, data: unknown) {
  const userConnections = connections.get(userId);

  if (!userConnections) {
    return;
  }

  const message = JSON.stringify(data);

  for (const ws of userConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}
