import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-C9gYKKPx.js");
var Route = createFileRoute("/cart")({
	loader: () => ({
		items: [],
		totals: {
			subtotal: 0,
			platformFee: 0,
			total: 0,
			paidCount: 0,
			freeCount: 0
		}
	}),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
