import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/prompts/$promptId.tsx
var $$splitComponentImporter = () => import("./_promptId-C7d_0cfd.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: ({ params }) => ({ promptId: Number(params.promptId) }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
