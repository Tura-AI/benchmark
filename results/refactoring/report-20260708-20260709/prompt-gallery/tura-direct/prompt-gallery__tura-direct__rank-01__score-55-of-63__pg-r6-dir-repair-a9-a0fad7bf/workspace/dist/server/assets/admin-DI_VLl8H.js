import { r as getAnalyticsFn } from "./functions-BtzvV4sV.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/admin.tsx
var $$splitComponentImporter = () => import("./admin-BfC30du-.js");
var Route = createFileRoute("/admin")({
	loader: () => getAnalyticsFn(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
