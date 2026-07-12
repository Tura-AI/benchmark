import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/icons.tsx
function BoltIcon() {
	return /* @__PURE__ */ jsx("span", {
		className: "bolt",
		children: /* @__PURE__ */ jsx("svg", {
			viewBox: "0 0 24 24",
			fill: "currentColor",
			"aria-hidden": "true",
			children: /* @__PURE__ */ jsx("path", { d: "M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" })
		})
	});
}
function Price({ price, className = "" }) {
	return /* @__PURE__ */ jsx("span", {
		className: `price ${price === 0 ? "free" : ""} ${className}`,
		children: price === 0 ? "Free" : `$${price}`
	});
}
//#endregion
//#region src/components/Toast.tsx
var ToastContext = createContext({ showToast: () => void 0 });
function useToast() {
	return useContext(ToastContext);
}
function ToastProvider({ children }) {
	const [toast, setToast] = useState("");
	const showToast = useCallback((message) => {
		setToast(message);
		window.setTimeout(() => setToast(""), 2100);
	}, []);
	const value = useMemo(() => ({ showToast }), [showToast]);
	return /* @__PURE__ */ jsxs(ToastContext.Provider, {
		value,
		children: [children, /* @__PURE__ */ jsxs("div", {
			className: `toast ${toast ? "show" : ""}`,
			role: "status",
			"aria-live": "polite",
			children: [/* @__PURE__ */ jsx("span", { className: "d" }), /* @__PURE__ */ jsx("span", { children: toast })]
		})]
	});
}
//#endregion
export { Price as i, useToast as n, BoltIcon as r, ToastProvider as t };
