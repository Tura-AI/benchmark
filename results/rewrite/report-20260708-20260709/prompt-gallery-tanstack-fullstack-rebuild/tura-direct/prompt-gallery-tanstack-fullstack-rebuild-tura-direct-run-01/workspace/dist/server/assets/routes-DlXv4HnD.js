import { t as Route } from "./routes-m7p3bhXJ.js";
import { i as Storefront } from "./components-nilCTifF.js";
import { jsx } from "react/jsx-runtime";
//#region src/routes/index.tsx?tsr-split=component
function StoreRoute() {
	return /* @__PURE__ */ jsx(Storefront, {
		catalog: Route.useLoaderData(),
		search: Route.useSearch()
	});
}
//#endregion
export { StoreRoute as component };
