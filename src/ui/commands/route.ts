/**
 * pi-subagents: parse the /subagents command without touching disk.
 */

export type SubagentsIntent =
	| { kind: "board" }
	| { kind: "name"; name: string }
	| { kind: "quick"; prompt: string }
	| { kind: "team"; prompt: string }
	| { kind: "team-on" }
	| { kind: "team-off" }
	| { kind: "team-board" }
	| { kind: "tasks" }
	| { kind: "trash" }
	| { kind: "list" }
	| { kind: "new" }
	| { kind: "help" };

export function routeSubagents(raw: string): SubagentsIntent {
	const text = raw.trim();
	if (!text) return { kind: "board" };
	const head = text.split(/\s+/, 1)[0] ?? "";
	const rest = text.slice(head.length).trim();
	const first = head.toLowerCase();
	if (first === "help" || first === "?") return { kind: "help" };
	if (first === "team" || first === "agent-team" || first === "agent-teams") {
		const action = rest.toLowerCase();
		if (!rest) return { kind: "team-board" };
		if (action === "on") return { kind: "team-on" };
		if (action === "off") return { kind: "team-off" };
		return { kind: "team", prompt: rest };
	}
	if (first === "run" || first === "finish") return { kind: "quick", prompt: rest };
	if (first === "new") return { kind: "new" };
	if (first === "list") return { kind: "list" };
	if (first === "tasks") return { kind: "tasks" };
	if (first === "trash") return { kind: "trash" };
	return { kind: "name", name: text };
}
