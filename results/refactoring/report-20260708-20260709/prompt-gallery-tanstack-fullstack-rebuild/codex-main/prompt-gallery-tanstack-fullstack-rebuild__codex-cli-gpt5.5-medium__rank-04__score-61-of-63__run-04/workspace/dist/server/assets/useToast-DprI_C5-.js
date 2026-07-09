import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/useToast.tsx
var ToastContext = createContext(() => void 0);
function ToastProvider({ children }) {
	const [message, setMessage] = useState("");
	const [visible, setVisible] = useState(false);
	const show = useCallback((next) => {
		setMessage(next);
		setVisible(true);
		window.setTimeout(() => setVisible(false), 2200);
	}, []);
	const value = useMemo(() => show, [show]);
	return /* @__PURE__ */ jsxs(ToastContext.Provider, {
		value,
		children: [children, /* @__PURE__ */ jsxs("div", {
			className: `toast ${visible ? "show" : ""}`,
			role: "status",
			"aria-live": "polite",
			children: [/* @__PURE__ */ jsx("span", { className: "d" }), /* @__PURE__ */ jsx("span", { children: message })]
		})]
	});
}
var useToast = () => useContext(ToastContext);
//#endregion
export { useToast as n, ToastProvider as t };
