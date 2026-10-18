import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3002/ws", {
  headers: {
    Origin: "http://localhost:5173",
  },
});

ws.on("open", () => {
  console.log("Connected to WebSocket!");

  ws.send(JSON.stringify({
    event: "test.message",
    data: {
      message: "Hello from my test client",
    },
  }));
});

ws.on("message", (data) => {
  console.log("Server says:", data.toString());

  const response = data.toString();

  if (response.includes('"test.ack"')) {
    console.log("SUCCESS: The server received my message.");
    ws.close();
  }
});

ws.on("error", (error) => {
  console.error("Connection error:", error.message);
});

ws.on("close", () => {
  console.log("Connection closed.");
});

