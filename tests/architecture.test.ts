/**
 * Architecture guard: the shape this package claims.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const root = new URL("..", import.meta.url).pathname;

const MAX_FILE_LINES = 250;

function sources(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...sources(full));
			continue;
		}
		if (entry.endsWith(".ts")) out.push(full);
	}
	return out;
}

function importsOf(file: string): string[] {
	const text = readFileSync(file, "utf8");
	const found: string[] = [];
	for (const match of text.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
		const spec = match[1];
		if (!spec) continue;
		const resolved = join(file, "..", spec);
		found.push(relative(root, resolved).replaceAll("\\", "/"));
	}
	return found;
}

function layerOf(rel: string): string {
	const parts = rel.split("/");
	return (parts[0] ?? "") === "src" && parts.length > 2 ? (parts[1] ?? "root") : "root";
}

const ALLOWED: Record<string, string[]> = {
	domain: ["domain"],
	infra: ["domain", "infra"],
	telemetry: ["domain", "telemetry"],
	app: ["domain", "infra", "telemetry", "app"],
	ui: ["domain", "infra", "telemetry", "app", "ui"],
	tools: ["domain", "infra", "telemetry", "app", "ui", "tools"],
};

describe("layer boundary: extensions -> src, never the reverse", () => {
	it("no src module imports the delivery layer", () => {
		const offenders: string[] = [];
		for (const file of sources(join(root, "src"))) {
			for (const target of importsOf(file)) {
				if (target.startsWith("extensions/")) {
					offenders.push(`${relative(root, file)} -> ${target}`);
				}
			}
		}
		assert.deepEqual(offenders, [], "src must not reach into extensions");
	});

	it("the extension entry wires the pieces instead of owning them", () => {
		const entry = readFileSync(join(root, "extensions/index.ts"), "utf8");
		assert.match(entry, /registerSubagentsCommand\(pi, store\)/);
		assert.doesNotMatch(entry, /async function runParallelTask/, "fan-out driver belongs in src");
		assert.doesNotMatch(entry, /function resultShell/, "result rendering belongs in src");
	});

	it("has no import cycle among src modules", () => {
		const files = sources(join(root, "src")).map((f) => relative(root, f).replaceAll("\\", "/"));
		const graph = new Map<string, string[]>();
		for (const rel of files) {
			const targets = importsOf(join(root, rel))
				.map((t) => (t.endsWith(".ts") ? t : `${t}.ts`))
				.filter((t) => files.includes(t));
			graph.set(rel, targets);
		}
		const state = new Map<string, "open" | "done">();
		const cycles: string[] = [];
		const walk = (node: string, path: string[]): void => {
			if (state.get(node) === "done") return;
			if (state.get(node) === "open") {
				cycles.push([...path, node].join(" -> "));
				return;
			}
			state.set(node, "open");
			for (const next of graph.get(node) ?? []) walk(next, [...path, node]);
			state.set(node, "done");
		};
		for (const node of graph.keys()) walk(node, []);
		assert.deepEqual(cycles, [], "an import cycle hides the dependency order");
	});
});

describe("layer direction: dependencies point inward", () => {
	it("no layer imports a layer above it", () => {
		const offenders: string[] = [];
		for (const file of sources(join(root, "src"))) {
			const rel = relative(root, file).replaceAll("\\", "/");
			const from = layerOf(rel);
			const allowed = ALLOWED[from];
			if (!allowed) continue;
			for (const target of importsOf(file)) {
				if (!target.startsWith("src/")) continue;
				const to = layerOf(target);
				if (to === "root" || allowed.includes(to)) continue;
				offenders.push(`${rel} -> ${target}`);
			}
		}
		assert.deepEqual(offenders, [], "a layer may only import the layers it is built on");
	});

	it("the domain layer stays free of the process environment", () => {
		// oxlint 1.88 has no no-process-env rule, so the intent needs
		// a real guard: a pure rule may not read the machine's setup.
		const offenders: string[] = [];
		for (const file of sources(join(root, "src", "domain"))) {
			const text = readFileSync(file, "utf8");
			if (/\bprocess\s*\.\s*env\b/.test(text)) {
				offenders.push(relative(root, file));
			}
		}
		assert.deepEqual(offenders, [], "the domain layer must not read process.env");
	});

	it("the domain layer stays free of host and disk code", () => {
		const offenders: string[] = [];
		for (const file of sources(join(root, "src", "domain"))) {
			const text = readFileSync(file, "utf8");
			// Type-only imports vanish at compile time, so they keep the
			// domain honest without a runtime dependency on the host.
			for (const match of text.matchAll(/^import\s+(?!type\b)[^;]*from\s+"([^"]+)"/gm)) {
				const spec = match[1] ?? "";
				if (spec.startsWith("node:") || spec.startsWith("@earendil-works/")) {
					offenders.push(`${relative(root, file)} -> ${spec}`);
				}
			}
		}
		assert.deepEqual(offenders, [], "the domain layer must stay pure");
	});
});

describe("file size: one file, one job", () => {
	it("no source file grows past the limit", () => {
		const offenders: string[] = [];
		for (const dir of ["src", "extensions", "tests"]) {
			for (const file of sources(join(root, dir))) {
				const lines = readFileSync(file, "utf8").split("\n").length;
				if (lines > MAX_FILE_LINES) {
					offenders.push(`${relative(root, file)}: ${lines} lines`);
				}
			}
		}
		assert.deepEqual(offenders, [], `every file stays under ${MAX_FILE_LINES} lines`);
	});
});
