import express from "express";
import { spawn } from "child_process";

const app = express();
const port = process.env.PORT || 8080;

// Active client sessions
const sessions = new Map();

// 1. Establish SSE stream
app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sessionId = Math.random().toString(36).substring(2, 12);

  // Spawn the GitHub MCP server child process
  const child = spawn("npx", ["-y", "@modelcontextprotocol/server-github"], {
    env: process.env,
    shell: true,
  });

  sessions.set(sessionId, { child, res });

  // Send the endpoint event according to the MCP SSE spec
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

  let buffer = "";
  child.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop(); // Hold incomplete chunk

    for (const line of lines) {
      if (line.trim()) {
        res.write(`event: message\ndata: ${line.trim()}\n\n`);
      }
    }
  });

  child.stderr.on("data", (err) => {
    console.error(`MCP Error: ${err}`);
  });

  req.on("close", () => {
    child.kill();
    sessions.delete(sessionId);
  });
});

// 2. Receive JSON-RPC messages from client
app.post("/messages", express.json(), (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).send("Session not found");
  }

  // Forward client message to the server's stdin
  session.child.stdin.write(JSON.stringify(req.body) + "\n");
  res.status(202).send("Accepted");
});

app.listen(port, () => {
  console.log(`GitHub MCP SSE server running on port ${port}`);
});
