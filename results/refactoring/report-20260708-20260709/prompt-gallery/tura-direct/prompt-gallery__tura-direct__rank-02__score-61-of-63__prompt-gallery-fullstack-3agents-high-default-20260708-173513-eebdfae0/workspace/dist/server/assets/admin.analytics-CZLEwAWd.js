import { r as getAnalytics } from "./functions-BOKx17ep.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/admin.analytics.tsx
var $$splitComponentImporter = () => import("./admin.analytics-DabEQHvy.js");
var Route = createFileRoute("/admin/analytics")({
	loader: () => getAnalytics(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
