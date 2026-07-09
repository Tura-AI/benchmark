import { useEffect } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/Toast.tsx
function Toast({ toast, onDone }) {
	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(onDone, 2200);
		return () => window.clearTimeout(timer);
	}, [toast, onDone]);
	return /* @__PURE__ */ jsxs("div", {
		className: `toast ${toast ? "show" : ""}`,
		children: [/* @__PURE__ */ jsx("span", { className: "toast-dot" }), /* @__PURE__ */ jsx("span", { children: toast?.text })]
	});
}
//#endregion
export { Toast as t };
