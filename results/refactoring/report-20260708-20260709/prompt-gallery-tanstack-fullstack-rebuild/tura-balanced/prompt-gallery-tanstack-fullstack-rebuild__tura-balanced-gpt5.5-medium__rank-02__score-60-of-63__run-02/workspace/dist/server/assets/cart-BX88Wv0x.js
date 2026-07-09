import { o as getStorefront, r as getCartState } from "./marketplace-sbgQtYxN.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-DxnqwCZd.js");
var Route = createFileRoute("/cart")({
	loader: async () => {
		const [cart, shell] = await Promise.all([getCartState(), getStorefront({ data: {} })]);
		return {
			cart,
			shell
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
