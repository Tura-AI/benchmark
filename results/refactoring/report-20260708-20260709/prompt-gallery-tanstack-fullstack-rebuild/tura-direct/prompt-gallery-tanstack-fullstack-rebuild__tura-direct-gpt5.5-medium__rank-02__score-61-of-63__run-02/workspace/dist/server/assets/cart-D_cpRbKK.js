import { i as getCartState } from "./functions-BOKx17ep.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-BTDb86Fw.js");
var Route = createFileRoute("/cart")({
	loader: () => getCartState(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
