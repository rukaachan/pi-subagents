#!/usr/bin/env node
/**
 * A tiny stdio MCP server with one tool. No dependencies: this is the real
 * protocol edge used by the MCP e2e, not a mock of our own code.
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
	send({ jsonrpc: "2.0", id, result: value });
}

rl.on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if (!message || typeof message !== "object" || typeof message.method !== "string") return;
	const { id, method, params } = message;
	if (method === "initialize") {
		result(id, {
			protocolVersion: params?.protocolVersion ?? "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "echo", version: "1.0.0" },
		});
		return;
	}
	if (id === undefined) return;
	if (method === "tools/list") {
		result(id, {
			tools: [
				{
					name: "echo",
					description: "Return the given text.",
					inputSchema: {
						type: "object",
						properties: { text: { type: "string" } },
						required: ["text"],
					},
				},
			],
		});
		return;
	}
	if (method === "tools/call") {
		const text = String(params?.arguments?.text ?? "");
		result(id, { content: [{ type: "text", text }], isError: false });
		return;
	}
	if (method === "ping") {
		result(id, {});
		return;
	}
	if (method === "resources/list") {
		result(id, { resources: [] });
		return;
	}
	if (method === "resources/templates/list") {
		result(id, { resourceTemplates: [] });
		return;
	}
	if (method === "prompts/list") {
		result(id, { prompts: [] });
		return;
	}
	send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
});

rl.on("close", () => process.exit(0));
