import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/toast.tsx
var ToastContext = createContext({ showToast: () => void 0 });
function ToastProvider({ children }) {
	const [message, setMessage] = useState("");
	const [open, setOpen] = useState(false);
	const showToast = useCallback((next) => {
		setMessage(next);
		setOpen(true);
	}, []);
	useEffect(() => {
		if (!open) return void 0;
		const timeout = window.setTimeout(() => setOpen(false), 1900);
		return () => window.clearTimeout(timeout);
	}, [open, message]);
	const value = useMemo(() => ({ showToast }), [showToast]);
	return /* @__PURE__ */ jsxs(ToastContext.Provider, {
		value,
		children: [children, /* @__PURE__ */ jsxs("div", {
			className: `toast ${open ? "show" : ""}`,
			role: "status",
			"aria-live": "polite",
			children: [/* @__PURE__ */ jsx("span", { className: "d" }), /* @__PURE__ */ jsx("span", { children: message })]
		})]
	});
}
function useToast() {
	return useContext(ToastContext);
}
//#endregion
export { useToast as n, ToastProvider as t };
