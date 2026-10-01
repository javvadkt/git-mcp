import express from "express";
import cors from "cors";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 8080;

// Enable CORS for all incoming requests (including OPTIONS preflight)
app.use(cors({ origin: "*" }));
app.use(express.json());

// Store isolated client sessions
const sessions = new Map();

// Root health check endpoint
app.get("/", (req, res) => {
  res.status(200).send("MCP Server is running");
});

// SSE Handshake endpoint
app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const sessionId = Math.random().toString(36).substring(2, 12);

  // Spawn an isolated GitHub MCP instance for this connection
  const child = spawn("npx", ["@modelcontextprotocol/server-github"], {
    env: { ...process.env },
    shell: true,
  });

  sessions.set(sessionId, { child, res });

  // Send the FULL absolute endpoint URL
  const host = req.get("host");
  const fullEndpointUrl = `https://${host}/message?sessionId=${sessionId}`;
  res.write(`event: endpoint\ndata: ${fullEndpointUrl}\n\n`);

  let buffer = "";
  child.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (line.trim()) {
        res.write(`event: message\ndata: ${line.trim()}\n\n`);
      }
    }
  });

  child.stderr.on("data", (err) => {
    console.error(`MCP stderr [${sessionId}]:`, err.toString());
  });

  req.on("close", () => {
    child.kill();
    sessions.delete(sessionId);
  });
});

// Message receiver endpoint
app.post("/message", (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).send("Session not found");
  }

  // Forward JSON-RPC message directly to the MCP process
  session.child.stdin.write(JSON.stringify(req.body) + "\n");
  res.status(202).send("Accepted");
});

app.listen(port, () => {
  console.log(`MCP server listening on port ${port}`);
});
