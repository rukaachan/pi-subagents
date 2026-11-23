/**
 * pi-subagents: one canonical form for workspace-relative paths.
 */

export type CanonicalPath = { ok: true; path: string } | { ok: false; error: string };

export function canonicalWorkspacePath(raw: string): CanonicalPath {
	const value = raw
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/{2,}/g, "/");
	if (!value) return { ok: false, error: "path is empty." };
	if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) {
		return { ok: false, error: "path must be workspace-relative." };
	}
	const segments: string[] = [];
	for (const segment of value.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") return { ok: false, error: 'path cannot contain "..".' };
		segments.push(segment);
	}
	if (segments.length === 0) return { ok: false, error: "path is empty." };
	return { ok: true, path: segments.join("/") };
}
