import { i as getCreatorAnalytics, o as getStorefront } from "./marketplace-sbgQtYxN.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/admin.tsx
var $$splitComponentImporter = () => import("./admin-Chfdx0tW.js");
var Route = createFileRoute("/admin")({
	loader: async () => {
		const [analytics, shell] = await Promise.all([getCreatorAnalytics(), getStorefront({ data: {} })]);
		return {
			analytics,
			shell
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
