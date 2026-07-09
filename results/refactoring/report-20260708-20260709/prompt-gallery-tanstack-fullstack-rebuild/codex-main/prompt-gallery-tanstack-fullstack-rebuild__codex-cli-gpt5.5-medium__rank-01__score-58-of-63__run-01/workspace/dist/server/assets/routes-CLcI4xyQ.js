import { r as fallbackFilters } from "./market-CFU9gbvr.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-IChOvjN2.js");
var Route = createFileRoute("/")({
	loader: () => ({
		prompts: [],
		filters: fallbackFilters
	}),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
