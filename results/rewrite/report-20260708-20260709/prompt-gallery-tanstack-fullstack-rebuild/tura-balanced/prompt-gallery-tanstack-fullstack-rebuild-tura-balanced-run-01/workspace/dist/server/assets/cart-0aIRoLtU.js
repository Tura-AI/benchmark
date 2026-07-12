import { i as getCartFn } from "./queries-BQK17jAu.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-CbH1dpdC.js");
var Route = createFileRoute("/cart")({
	loader: async () => ({ cart: await getCartFn() }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
