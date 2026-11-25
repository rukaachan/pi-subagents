/**
 * Shared menu constants.
 */

export const ROUTE = {
	cancel: "\u0000cancel",
} as const;

export type RouteValue = (typeof ROUTE)[keyof typeof ROUTE];

export function isRoute(value: string): value is RouteValue {
	return value.startsWith("\u0000");
}
