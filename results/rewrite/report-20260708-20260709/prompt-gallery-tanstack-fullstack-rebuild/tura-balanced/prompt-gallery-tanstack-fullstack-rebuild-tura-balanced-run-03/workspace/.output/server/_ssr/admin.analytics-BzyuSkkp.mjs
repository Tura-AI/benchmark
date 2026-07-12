import { f as lazyRouteComponent, p as createFileRoute } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as loadAnalytics } from "./server-Cp9Zv1gM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.analytics-BzyuSkkp.js
var $$splitComponentImporter = () => import("./admin.analytics-Bqp-ZSD7.mjs");
var Route = createFileRoute("/admin/analytics")({
	loader: () => loadAnalytics(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
