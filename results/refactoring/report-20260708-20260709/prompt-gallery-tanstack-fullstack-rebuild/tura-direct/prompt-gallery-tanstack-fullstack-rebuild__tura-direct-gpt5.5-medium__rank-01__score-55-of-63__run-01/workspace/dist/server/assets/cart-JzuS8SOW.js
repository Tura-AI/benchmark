import { i as getCartFn } from "./functions-BtzvV4sV.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-Gu9niufh.js");
var Route = createFileRoute("/cart")({
	loader: () => getCartFn(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
