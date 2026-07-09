import { t as getJson } from "./client-api-COuYp5Ys.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-BOw4O4gQ.js");
var Route = createFileRoute("/cart")({
	loader: async () => {
		if (typeof window === "undefined") {
			const { cartApi, storefrontApi } = await import("./api-SnfGUBjd.js");
			return {
				cart: cartApi(),
				categories: storefrontApi().categories
			};
		}
		return getJson("/api/cart");
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
