/**
 * pi-subagents: how many of our own dialogs are on screen.
 */

let open = 0;

export function isModalOpen(): boolean {
	return open > 0;
}

/** How many dialogs are open. Exposed for the invariant tests. */
export function modalDepth(): number {
	return open;
}

// Run a dialog.
export async function inModal<T>(run: () => Promise<T>): Promise<T> {
	open += 1;
	try {
		return await run();
	} finally {
		open -= 1;
	}
}
