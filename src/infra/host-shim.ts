/**
 * pi-subagents: argument shims.
 */

type Dict = Record<string, unknown>;

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function taskArgs(args: unknown): Dict {
	const a = (args ?? {}) as Dict;
	const chain = parseChain(a.chain);
	const subagentType = str(a.subagent_type) ?? str(a.agent) ?? str(a.subagent) ?? str(a.name) ?? "";
	const prompt =
		str(a.prompt) ??
		str(a.task) ??
		(chain ? chain.steps.map((s) => s.prompt).join("\n") : "") ??
		"";
	const description =
		str(a.description) ?? str(a.label) ?? (prompt ? prompt.slice(0, 60) : subagentType || "task");
	const out: Dict = { subagent_type: subagentType, description, prompt };
	for (const k of [
		"complexity",
		"model",
		"codemode",
		"run_in_background",
		"resume",
		"parallel",
		"budget",
		"temp_definition",
	]) {
		if (a[k] !== undefined) out[k] = a[k];
	}
	if (Array.isArray(out.parallel) && out.parallel.length === 0) {
		delete out.parallel;
	}
	if (chain) {
		out.chain = chain.steps.map((s) => s.subagent);
		if (chain.prompt) out.prompt = chain.prompt;
	}
	const parallel = parseParallel(a.parallel);
	if (parallel) {
		out.parallel = parallel.steps.map((s) =>
			s.prompt ? { subagent_type: s.subagent, prompt: s.prompt } : s.subagent,
		);
		if (parallel.prompt) out.prompt = parallel.prompt;
	}
	if (out.run_in_background === undefined && typeof a.background === "boolean") {
		out.run_in_background = a.background;
	}
	return out;
}

export interface ParsedChain {
	steps: { subagent: string; prompt: string }[];
	prompt: string;
}

function parseChain(value: unknown): ParsedChain | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const steps: { subagent: string; prompt: string }[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			const name = item.trim();
			if (name) steps.push({ subagent: name, prompt: "" });
			continue;
		}
		if (item && typeof item === "object") {
			const o = item as Dict;
			const name = str(o.subagent_type) ?? str(o.agent) ?? str(o.subagent) ?? str(o.name);
			if (name) steps.push({ subagent: name, prompt: str(o.prompt) ?? str(o.task) ?? "" });
		}
	}
	if (steps.length === 0) return null;
	const own = steps
		.map((s) => s.prompt)
		.filter(Boolean)
		.join("\n");
	return { steps, prompt: own };
}

function parseParallel(value: unknown): ParsedChain | null {
	return parseChain(value);
}

export function subagentArgs(args: unknown): Dict {
	const a = (args ?? {}) as Dict;
	const chain = parseChain(a.chain);
	const agent = str(a.agent) ?? str(a.subagent_type) ?? str(a.subagent) ?? str(a.name) ?? "";
	const task =
		str(a.task) ?? str(a.prompt) ?? str(a.description) ?? (chain ? chain.prompt : "") ?? "";
	const out: Dict = { agent, task };
	for (const key of ["description", "tasks", "model", "complexity", "codemode", "budget"]) {
		if (a[key] !== undefined) out[key] = a[key];
	}
	if (chain) out.chain = chain.steps.map((s) => s.subagent);
	return out;
}
