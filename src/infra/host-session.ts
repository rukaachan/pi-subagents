/**
 * pi-subagents: starting a child session in the host.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	createAgentSession,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { clampToolsForAutonomy } from "../domain/subagent/config.ts";
import type { SubagentConfig } from "../domain/subagent/config.ts";
import { planCodemode, withScriptRoute } from "../domain/subagent/codemode.ts";

// The host surface for codemode.
type CodemodeHost = {
	createCodemodeExtension?(options?: { models?: boolean; mode?: "on" | "only" }): unknown;
};

export interface LiveChild {
	session: AgentSession;
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
		const host = (await import("@earendil-works/pi-coding-agent")) as unknown as CodemodeHost;
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

	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
		systemPrompt: plan ? withScriptRoute(sub.systemPrompt) : sub.systemPrompt,
		...(codemodeFactories
			? {
					extensionFactories: codemodeFactories as never as ConstructorParameters<
						typeof DefaultResourceLoader
					>[0]["extensionFactories"],
				}
			: {}),
	});
	await loader.reload();

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel,
		tools: sessionTools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});
	return { session, subagent: sub, tools: sessionTools, notes, cwd };
}
