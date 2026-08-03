import fs from "node:fs";
import net from "node:net";

const credentialsPath = process.argv[2];
if (!credentialsPath) throw new Error("credentials file is required");
const requestedSubjects = process.argv.slice(3);
if (!requestedSubjects.length) throw new Error("at least one exact subject is required");
if (requestedSubjects.some((subject) => subject.includes(">") || subject.includes("*"))) {
  throw new Error("wildcard subjects are not allowed");
}
const rows = fs.readFileSync(credentialsPath, "utf8").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
const labeled = Object.fromEntries(rows.flatMap((row) => {
  const match = row.match(/^(用户名|密码|域名)\s*[:：]\s*(\S+)/);
  return match ? [[match[1], match[2]]] : [];
}));
const values = rows.map((row) => row.split(/\s+/)[0]);
const [user, pass, host] = labeled["用户名"] && labeled["密码"] && labeled["域名"]
  ? [labeled["用户名"], labeled["密码"], labeled["域名"]]
  : values;
if (!user || !pass || !host) throw new Error("credentials file must contain user, password, host");
const subjects = new Map();
let buffer = Buffer.alloc(0);
let connected = false;
let authenticated = false;
let subscribed = false;

const socket = net.createConnection({ host, port: 4222 });
socket.setTimeout(10_000);
socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (!connected) {
    const end = buffer.indexOf("\r\n");
    if (end < 0) return;
    const first = buffer.subarray(0, end).toString("utf8");
    buffer = buffer.subarray(end + 2);
    if (!first.startsWith("INFO ")) throw new Error("unexpected NATS greeting");
    connected = true;
    const auth = JSON.stringify({ verbose: false, pedantic: false, user, pass, lang: "node", version: "1.0", protocol: 1 });
    socket.write(`CONNECT ${auth}\r\nPING\r\n`);
  }
  while (true) {
    const end = buffer.indexOf("\r\n");
    if (end < 0) break;
    const header = buffer.subarray(0, end).toString("utf8");
    if (header === "PONG" && !authenticated) {
      authenticated = true;
      const subscriptions = requestedSubjects
        .map((subject, index) => `SUB ${subject} ${index + 1}\r\n`)
        .join("");
      socket.write(`${subscriptions}PING\r\n`);
      subscribed = true;
    }
    if (header.startsWith("-ERR")) {
      const safe = header.replaceAll(user, "[user]").replaceAll(pass, "[password]");
      const phase = authenticated ? "subscription" : "login";
      throw new Error(`NATS rejected ${phase}: ${safe}`);
    }
    if (!header.startsWith("MSG ")) {
      buffer = buffer.subarray(end + 2);
      continue;
    }
    const parts = header.split(" ");
    const size = Number(parts.at(-1));
    const frameEnd = end + 2 + size + 2;
    if (!Number.isFinite(size) || buffer.length < frameEnd) break;
    const subject = parts[1];
    const prior = subjects.get(subject) ?? { count: 0, sizes: new Set() };
    prior.count += 1;
    prior.sizes.add(size);
    subjects.set(subject, prior);
    buffer = buffer.subarray(frameEnd);
  }
});
socket.on("timeout", () => socket.destroy());
socket.on("error", (error) => {
  console.error(error.message.replace(user, "[user]").replace(pass, "[password]"));
  process.exitCode = 1;
});

setTimeout(() => {
  socket.end();
  console.log(JSON.stringify({
    connected,
    authenticated,
    subscribed,
    subjects: [...subjects.entries()].map(([subject, value]) => ({
      subject,
      messages: value.count,
      payloadBytes: [...value.sizes].sort((a, b) => a - b),
    })),
  }, null, 2));
}, 8_000);
