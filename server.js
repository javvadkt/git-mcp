import express from "express";
import cors from "cors";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 8080;

// Enable CORS for web clients like Gemini
app.use(cors({ origin: "*" }));
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.status(200).send("MCP Server is running");
});

// Active sessions map
const sessions = new Map();

// SSE Handler
const handleSSE = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const sessionId = Math.random().toString(36).substring(2, 12);

  // Use the pre-installed local binary directly for instant response
  const child = spawn("npx", ["@modelcontextprotocol/server-github"], {
    env: process.env,
    shell: true,
  });

  sessions.set(sessionId, { child, res });

  // Use the full absolute URL so Gemini routes messages to your server
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.get("host");
  const fullEndpointUrl = `${protocol}://${host}/messages?sessionId=${sessionId}`;

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
    console.error(`MCP process log: ${err}`);
  });

  req.on("close", () => {
    child.kill();
    sessions.delete(sessionId);
  });
};

// Support both /sse and /mcp endpoints
app.get("/sse", handleSSE);
app.get("/mcp", handleSSE);

// Client message receiver
app.post("/messages", (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).send("Session not found");
  }

  session.child.stdin.write(JSON.stringify(req.body) + "\n");
  res.status(202).send("Accepted");
});

app.listen(port, () => {
  console.log(`MCP server active on port ${port}`);
});
