import { o as getPromptDetail } from "./functions-BOKx17ep.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/prompts.$promptId.tsx
var $$splitComponentImporter = () => import("./prompts._promptId-DoQIUftd.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: ({ params }) => getPromptDetail({ data: params.promptId }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
