import { t as Route } from "./prompts._promptId-5g8nM-UB.js";
import { n as PromptPreview } from "./Gallery-Bq235nby.js";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft } from "lucide-react";
//#region src/routes/prompts.$promptId.tsx?tsr-split=component
function PromptDetail() {
	const prompt = Route.useLoaderData();
	return /* @__PURE__ */ jsxs("div", {
		className: "detail-page",
		children: [/* @__PURE__ */ jsxs(Link, {
			to: "/",
			className: "back-link",
			children: [/* @__PURE__ */ jsx(ArrowLeft, {}), " Back to gallery"]
		}), /* @__PURE__ */ jsx(PromptPreview, { prompt })]
	});
}
//#endregion
export { PromptDetail as component };
