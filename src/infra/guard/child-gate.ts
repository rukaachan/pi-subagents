/**
 * pi-subagents: the package-owned gate for a child session.
 */

import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";

/** One blocked call, as the caller's telemetry wants it. */
export interface GateBlock {
	tool: string;
	reason: string;
}

export interface ChildGateOptions {
	/** Ask before allowing; production passes none, so a child always blocks. */
	confirm?: (detail: string) => Promise<boolean>;
	/** Receives each block; the app layer wires it to the journal. */
	record?: (block: GateBlock) => void;
}

interface Rule {
	pattern: RegExp;
	say: string;
}

const SHELL_RULES: readonly Rule[] = [
	{ pattern: /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, say: "recursive delete" },
	{ pattern: /\bsudo\b/, say: "sudo" },
	{ pattern: /\bmkfs(\.[a-z0-9]+)?\b/, say: "filesystem format" },
	{ pattern: /\bdd\b[^\n]*\bof=\/dev\//, say: "raw disk write" },
	{ pattern: /\b(shutdown|reboot|halt|poweroff)\b/, say: "machine power" },
	{ pattern: /\b(chmod|chown)\b[^\n]*\b777\b/, say: "world-writable permissions" },
	{
		pattern: /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?\b|(?:^|\s)-f(?:\s|$))/,
		say: "force push",
	},
	{ pattern: /\bgit\s+reset\b[^\n]*--hard\b/, say: "hard reset" },
	{ pattern: /\bgit\s+clean\b[^\n]*\s-[a-zA-Z]*f/, say: "clean untracked files" },
	{ pattern: /(?:>|of=)\s*\/dev\/(?:sd|nvme|hd)/, say: "block device write" },
];

function commandOf(event: ToolCallEvent): string | undefined {
	if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;
	const command = (event.input as { command?: unknown }).command;
	return typeof command === "string" ? command : undefined;
}

/** One short line naming what the call would do, or undefined when it is allowed. */
export function gateDetail(
	event: ToolCallEvent,
	getAllTools?: () => Array<{
		name: string;
		annotations?: { destructiveHint?: boolean };
	}>,
): string | undefined {
	const command = commandOf(event);
	if (command !== undefined) {
		const rule = SHELL_RULES.find((candidate) => candidate.pattern.test(command));
		return rule ? `${rule.say} (${event.toolName})` : undefined;
	}
	const info = getAllTools?.().find((tool) => tool.name === event.toolName);
	return info?.annotations?.destructiveHint
		? `${event.toolName} may delete or overwrite`
		: undefined;
}

/** A factory for DefaultResourceLoader({ extensionFactories }); it blocks, never prompts by itself. */
export function createChildGateExtension(options: ChildGateOptions = {}) {
	return (pi: ExtensionAPI): void => {
		pi.on("tool_call", async (event) => {
			const detail = gateDetail(event, () => pi.getAllTools());
			if (!detail) return undefined;
			if (options.confirm && (await options.confirm(detail))) return undefined;
			options.record?.({ tool: event.toolName, reason: detail });
			return { block: true, reason: `gates: ${detail}. Narrow the task or turn gates off.` };
		});
	};
}
