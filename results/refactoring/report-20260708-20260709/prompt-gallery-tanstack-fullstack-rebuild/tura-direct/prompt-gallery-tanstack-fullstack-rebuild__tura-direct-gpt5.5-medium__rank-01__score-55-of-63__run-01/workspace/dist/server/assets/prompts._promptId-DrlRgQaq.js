import { t as Route } from "./prompts._promptId-B5gKGTZT.js";
import { r as DetailView } from "./components-nilCTifF.js";
import { jsx } from "react/jsx-runtime";
//#region src/routes/prompts.$promptId.tsx?tsr-split=component
function PromptRoute() {
	const { prompt, related } = Route.useLoaderData();
	return /* @__PURE__ */ jsx(DetailView, {
		prompt,
		related
	});
}
//#endregion
export { PromptRoute as component };
