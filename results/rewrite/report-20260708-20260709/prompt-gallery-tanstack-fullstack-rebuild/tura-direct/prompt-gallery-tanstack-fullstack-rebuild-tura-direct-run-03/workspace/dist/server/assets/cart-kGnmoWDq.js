import { i as fetchCatalog, r as fetchCart } from "./serverFns-o3k0et2Q.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/cart.tsx
var $$splitComponentImporter = () => import("./cart-BE2kszQn.js");
var Route = createFileRoute("/cart")({
	loader: async () => ({
		cart: await fetchCart(),
		shell: await fetchCatalog({ data: {} })
	}),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
