import { l as Route } from "./serverFns-o3k0et2Q.js";
import { t as Route$1 } from "./cart-kGnmoWDq.js";
import { t as Route$2 } from "./admin-BJ2c5yM2.js";
import { t as Route$3 } from "./routes-DvAczL0M.js";
import { t as Route$4 } from "./prompts._promptId-Dm9cMMKM.js";
import { createRouter as createRouter$1 } from "@tanstack/react-router";
//#region src/routeTree.gen.ts
var CartRoute = Route$1.update({
	id: "/cart",
	path: "/cart",
	getParentRoute: () => Route
});
var AdminRoute = Route$2.update({
	id: "/admin",
	path: "/admin",
	getParentRoute: () => Route
});
var rootRouteChildren = {
	IndexRoute: Route$3.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route
	}),
	AdminRoute,
	CartRoute,
	PromptsPromptIdRoute: Route$4.update({
		id: "/prompts/$promptId",
		path: "/prompts/$promptId",
		getParentRoute: () => Route
	})
};
var routeTree = Route._addFileChildren(rootRouteChildren)._addFileTypes();
//#endregion
//#region src/router.tsx
function createRouter() {
	return createRouter$1({
		routeTree,
		defaultPreload: "intent",
		scrollRestoration: true
	});
}
var getRouter = createRouter;
//#endregion
export { createRouter, getRouter };
