import { n as api } from "./market-api-BGNTLaER.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/admin.tsx
var $$splitComponentImporter = () => import("./admin---QPdVQJ.js");
var Route = createFileRoute("/admin")({
	loader: () => api.analytics(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
