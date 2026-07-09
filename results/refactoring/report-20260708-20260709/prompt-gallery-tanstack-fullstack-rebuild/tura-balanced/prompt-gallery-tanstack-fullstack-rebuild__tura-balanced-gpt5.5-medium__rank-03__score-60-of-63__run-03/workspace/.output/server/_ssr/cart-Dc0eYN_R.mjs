import { f as lazyRouteComponent, p as createFileRoute } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as loadCart } from "./server-Cp9Zv1gM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/cart-Dc0eYN_R.js
var $$splitComponentImporter = () => import("./cart-Cc0Tnql5.mjs");
var Route = createFileRoute("/cart")({
	loader: () => loadCart(),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
