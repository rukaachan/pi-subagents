/**
 * pi-subagents: starting a child session in the host.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	createAgentSession,
	createEditToolDefinition,
	createWriteToolDefinition,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { createChildGateExtension } from "./child-gate.ts";
import type { GateBlock } from "./child-gate.ts";
import { contextNote } from "./child-context.ts";
import { guardPaths } from "./tool-guard.ts";
import { clampToolsForAutonomy } from "../domain/subagent/index.ts";
import type { SubagentConfig } from "../domain/subagent/index.ts";
import { planCodemode, withScriptRoute } from "../domain/task/index.ts";
import { contractPrompt } from "../domain/run/index.ts";
import { taskPrompt } from "../domain/subagent/index.ts";

// The host surface for codemode and MCP.
type ChildExtensionHost = {
	createCodemodeExtension?(options?: { models?: boolean; mode?: "on" | "only" }): unknown;
	createMcpExtension?(): unknown;
};

export interface ChildExtras {
	/** Extra custom tools, e.g. the teammate's Team tool. */
	tools?: ToolDefinition[];
	/** Names to activate after session creation, without narrowing the subagent's tool list. */
	activate?: string[];
	/** Prepended once to the first task prompt. */
	promptPrefix?: string;
	/** Receives gate blocks; may be undefined, and then nothing is recorded. */
	onGateBlock?: (block: GateBlock) => void;
}

/** Keep an explicit tool list, or add one tool to Pi's default selection. */
export function activateTools(
	selected: readonly string[] | undefined,
	activate: readonly string[],
): string[] | undefined {
	if (activate.length === 0) return selected ? [...selected] : undefined;
	return selected ? [...new Set([...selected, ...activate])] : activate.map((name) => `+${name}`);
}

export interface LiveChild {
	session: AgentSession;
	/** Send task text with this subagent's prefix and the caller's contract applied. */
	prompt: (text: string, contract?: readonly string[]) => Promise<void>;
	subagent: SubagentConfig;
	tools?: string[];
	notes: string[];
	cwd: string;
}

function resolveModel(
	sub: SubagentConfig,
	ctx: ExtensionContext,
): { model?: Model<Api>; error?: string } {
	if (sub.model === "inherit" || !sub.model) return { model: ctx.model };
	const slash = sub.model.indexOf("/");
	if (slash <= 0 || slash === sub.model.length - 1) {
		return { error: `Invalid model "${sub.model}". Use "inherit" or "provider/id".` };
	}
	const provider = sub.model.slice(0, slash);
	const id = sub.model.slice(slash + 1);
	const found = ctx.modelRegistry.find(provider, id);
	if (!found) return { error: `Unknown model "${sub.model}". Falls back to parent model.` };
	return { model: found };
}

export async function startSubagentSession(
	sub: SubagentConfig,
	cwd: string,
	ctx: ExtensionContext,
	extras?: ChildExtras,
): Promise<LiveChild> {
	const notes: string[] = [...sub.warnings];
	const { tools, notes: clampNotes } = clampToolsForAutonomy(sub);
	notes.push(...clampNotes);

	const resolved = resolveModel(sub, ctx);
	let model = ctx.model;
	if (resolved.error) notes.push(resolved.error);
	else if (resolved.model) model = resolved.model;

	let thinkingLevel: ThinkingLevel | undefined;
	if (sub.model === "inherit" || !sub.model) {
		thinkingLevel = ctx.thinkingLevel;
	} else if (sub.thinkingLevel) {
		thinkingLevel = sub.thinkingLevel;
	}

	let sessionTools = tools;
	let codemodeFactories: unknown[] | undefined;
	let mcpFactories: unknown[] | undefined;
	let gateFactories: unknown[] | undefined;
	const settingsManager = SettingsManager.create(cwd, getAgentDir());
	// A subagent with no tools line gets the host's own default
	// selection, so granting codemode does not narrow it.
	const defaultTools = settingsManager.getDefaultTools() ?? undefined;
	const plan = planCodemode(sub, tools, defaultTools);
	if (!plan && sub.codemode === false) {
		notes.push("codemode off: the run keeps the ordinary tools, without scripting.");
	}
	if (plan) {
		sessionTools = plan.toolIds;
		const host = (await import("@earendil-works/pi-coding-agent")) as unknown as ChildExtensionHost;
		const createCodemodeExtension = host.createCodemodeExtension;
		if (typeof createCodemodeExtension !== "function") {
			// An older host without the factory: the scripting tool does
			// not exist, so the run keeps the ordinary tools and says so.
			// Never a leg with no tool at all.
			notes.push("codemode unavailable on this host: the run keeps the ordinary tools.");
			codemodeFactories = undefined;
			sessionTools = tools?.filter((t) => t !== "codemode");
		} else {
			codemodeFactories = [createCodemodeExtension({ models: false, mode: plan.mode })];
		}
	}

	if (sub.mcp) {
		const host = (await import("@earendil-works/pi-coding-agent")) as unknown as ChildExtensionHost;
		const createMcpExtension = host.createMcpExtension;
		if (typeof createMcpExtension !== "function") {
			notes.push("MCP unavailable on this host: the run keeps the ordinary tools.");
		} else {
			mcpFactories = [createMcpExtension()];
		}
	}

	if (sub.gates) gateFactories = [createChildGateExtension({ record: extras?.onGateBlock })];

	const factories = [
		...(codemodeFactories ?? []),
		...(mcpFactories ?? []),
		...(gateFactories ?? []),
	];
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: !sub.context,
		systemPrompt: plan ? withScriptRoute(sub.systemPrompt) : sub.systemPrompt,
		...(factories.length > 0
			? {
					extensionFactories: factories as never as ConstructorParameters<
						typeof DefaultResourceLoader
					>[0]["extensionFactories"],
				}
			: {}),
	});
	await loader.reload();
	if (sub.context) {
		notes.push(contextNote(loader.getAgentsFiles().agentsFiles, cwd));
	}

	const fenced = sub.paths && sub.paths.length > 0;
	const builtTools = [
		...(fenced
			? [
					guardPaths(createWriteToolDefinition(cwd), sub.paths ?? [], cwd),
					guardPaths(createEditToolDefinition(cwd), sub.paths ?? [], cwd),
				]
			: []),
		...(extras?.tools ?? []),
	] as ToolDefinition[];
	const customTools = builtTools.length > 0 ? builtTools : undefined;
	// A shell can write anywhere; it is off whenever writes have a fence.
	const excludeTools = fenced ? ["bash", "powershell"] : undefined;
	if (fenced) {
		notes.push(`paths: writes limited to ${sub.paths?.join(", ")}; bash is off.`);
	}

	if (extras?.activate?.length) {
		sessionTools = activateTools(sessionTools, extras.activate);
	}

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel,
		tools: sessionTools,
		excludeTools,
		customTools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});
	if (mcpFactories || gateFactories) {
		try {
			await session.bindExtensions({});
		} catch (err) {
			notes.push(`extras failed to bind: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return {
		session,
		prompt: (text, contract) =>
			session.prompt(
				`${extras?.promptPrefix ?? ""}${taskPrompt(sub, text)}${contractPrompt(contract ?? [])}`,
			),
		subagent: sub,
		tools: sessionTools,
		notes,
		cwd,
	};
}
