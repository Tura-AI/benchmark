import { t as getJson } from "./client-api-COuYp5Ys.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/admin.tsx
var $$splitComponentImporter = () => import("./admin-DIbQQMWJ.js");
var Route = createFileRoute("/admin")({
	loader: async () => {
		if (typeof window === "undefined") {
			const { analyticsApi, storefrontApi } = await import("./api-SnfGUBjd.js");
			const shell = storefrontApi();
			return {
				analytics: analyticsApi(),
				categories: shell.categories,
				cart: shell.cart
			};
		}
		return getJson("/api/analytics");
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
