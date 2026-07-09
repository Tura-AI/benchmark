import { jsx } from "react/jsx-runtime";
function Toast({ message }) {
  return /* @__PURE__ */ jsx("div", { className: `toast ${message ? "show" : ""}`, role: "status", "aria-live": "polite", children: message });
}
export {
  Toast as T
};
