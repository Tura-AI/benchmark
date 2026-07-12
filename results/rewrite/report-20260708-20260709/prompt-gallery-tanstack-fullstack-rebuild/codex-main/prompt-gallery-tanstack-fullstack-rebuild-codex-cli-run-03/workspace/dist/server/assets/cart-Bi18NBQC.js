import { n as api } from "./market-api-BGNTLaER.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-DpzhIc8M.js");
var Route = createFileRoute("/cart")({
	loader: () => api.cart(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
