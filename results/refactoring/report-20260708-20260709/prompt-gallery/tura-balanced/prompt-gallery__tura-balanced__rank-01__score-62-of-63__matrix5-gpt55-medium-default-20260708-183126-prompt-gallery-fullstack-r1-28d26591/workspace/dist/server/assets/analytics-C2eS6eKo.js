import { i as getCartFn, r as getAnalyticsFn } from "./queries-BQK17jAu.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/analytics.tsx
var $$splitComponentImporter = () => import("./analytics-DrklyyYM.js");
var Route = createFileRoute("/analytics")({
	loader: async () => {
		const [analytics, cart] = await Promise.all([getAnalyticsFn(), getCartFn()]);
		return {
			analytics,
			cart
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
