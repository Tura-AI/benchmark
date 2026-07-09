import { i as fetchCatalog, n as fetchAnalytics } from "./serverFns-o3k0et2Q.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/admin.tsx
var $$splitComponentImporter = () => import("./admin-DAfy4FcF.js");
var Route = createFileRoute("/admin")({
	loader: async () => ({
		analytics: await fetchAnalytics(),
		shell: await fetchCatalog({ data: {} })
	}),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
